import type {
  ChargeRequestDraft,
  ChargeStatus,
  ClientChargeView,
  ClientTokenization,
  MaskedProviderConfig,
  MerchantFailoverPolicy,
  MerchantSettingsView,
  PaymentEnvironment,
  ProviderName,
  ProviderSetupGuide,
  SaveCredentialsInput,
  VerifiedProviderConfig,
} from '@12-apps/payments-backend';

/**
 * Browser-side API clients. They talk to the HOST's endpoints (which mount
 * `@12-apps/payments-backend`'s HTTP handlers) — never to a provider directly.
 * Endpoint paths are injected so every app can mount its routes wherever it
 * likes; the shapes are fixed so the components work identically everywhere.
 *
 * Only TYPES are imported from the backend package — no server code ever
 * enters a browser bundle.
 */

/** Charge states the frontend should stop polling on. */
export function isSettled(status: ChargeStatus): boolean {
  return status !== 'PENDING' && status !== 'AUTHORIZED';
}

/**
 * What the browser sends to create a charge. Card data is TOKENS ONLY, and
 * there is deliberately no `amount`/`reference`: the SERVER resolves what is
 * owed and for which order (see the backend's `resolveChargeRequest`), so a
 * tampered client cannot underpay or point a payment at someone else's order.
 */
export type ClientChargeRequest = ChargeRequestDraft;

/** Client-safe tokenization config (see the backend's `clientConfig`). */
export interface ClientPaymentsConfig {
  provider: ProviderName;
  tokenization: ClientTokenization;
  publicKey?: string;
}

export class PaymentsClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentsClientError';
  }
}

export interface PaymentsClientOptions {
  /** e.g. `/api/payments` — host route prefix wrapping the gateway. */
  baseUrl: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * The sentence a failed request carries, rather than the response body.
 *
 * The body is a JSON envelope, and throwing it verbatim put
 * `{"error":"CredentialsError","message":"No platform OAuth application
 * credentials configured for stripe/SANDBOX"}` on a store owner's settings
 * screen, inside a red alert, as the entire explanation of why a button did
 * nothing. Unwrapping `message` is the floor: it is the only field written to
 * be read, and an error class name is never the owner's problem.
 *
 * That message may still be developer English — the surfaces that can do better
 * translate it (see `ProviderConnection`). This function's job is only to stop
 * shipping the envelope.
 */
function failureMessage(body: string, status: number): string {
  const fallback = `Payments request failed (${status})`;
  if (!body) return fallback;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === 'object' && 'message' in parsed) {
      const { message } = parsed as { message?: unknown };
      if (typeof message === 'string' && message.trim() !== '') return message;
    }
  } catch {
    // Not JSON — a proxy's HTML error page, a gateway timeout. The raw text is
    // still the most informative thing available.
  }
  return body;
}

function makeRequest(options: PaymentsClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(`${options.baseUrl}${path}`, {
      headers: { 'content-type': 'application/json' },
      ...init,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new PaymentsClientError(res.status, failureMessage(body, res.status));
    }
    return (await res.json()) as T;
  };
}

/** Checkout-surface client (buyer-facing). */
export interface PaymentsClient {
  getConfig(): Promise<ClientPaymentsConfig | null>;
  createCharge(request: ClientChargeRequest): Promise<ClientChargeView>;
  getCharge(provider: ProviderName, providerChargeId: string): Promise<ClientChargeView>;
}

export function createPaymentsClient(options: PaymentsClientOptions): PaymentsClient {
  const request = makeRequest(options);
  return {
    getConfig: () => request<ClientPaymentsConfig | null>('/config'),
    createCharge: (body) =>
      request<ClientChargeView>('/charges', { method: 'POST', body: JSON.stringify(body) }),
    getCharge: (provider, providerChargeId) =>
      request<ClientChargeView>(
        `/charges/${encodeURIComponent(provider)}/${encodeURIComponent(providerChargeId)}`,
      ),
  };
}

/** Settings-surface client (merchant-admin-facing). */
export interface PaymentsSettingsClient {
  /**
   * The host prefix this client was built on, echoed back.
   *
   * Exposed because it is the only MERCHANT-SCOPED identifier the components
   * have: the package is deliberately ignorant of tenants, and a host mounts
   * one client per store (`/api/admin/<slug>/payments`). Anything the browser
   * remembers per store — a setup step the owner has ticked off — has to be
   * keyed on something, and this is it. Read-only; nothing derives a request
   * path from it.
   */
  readonly baseUrl: string;
  getSettings(): Promise<MerchantSettingsView>;
  saveCredentials(provider: ProviderName, input: SaveCredentialsInput): Promise<MaskedProviderConfig>;
  setEnabled(provider: ProviderName, enabled: boolean): Promise<MaskedProviderConfig>;
  /**
   * Replace the whole failover chain in priority order. Sends the COMPLETE
   * enabled set, not a delta — a reorder is one intent, and splitting it into
   * per-provider writes is what allows a half-applied order.
   */
  setPriorities(ordered: readonly ProviderName[]): Promise<MerchantSettingsView>;
  /** Whether a declined card may be retried on the next acquirer. */
  setFailoverPolicy(policy: MerchantFailoverPolicy): Promise<MerchantSettingsView>;
  /**
   * Probe the stored credentials for `environment` (default: the active one).
   *
   * The reply carries `probe` because the stored `status` answers only for the
   * ACTIVE environment — testing the other tab reports its result without
   * overwriting a verdict that describes different credentials.
   */
  verify(
    provider: ProviderName,
    environment?: PaymentEnvironment,
  ): Promise<VerifiedProviderConfig>;
  /** Null when the provider ships no walkthrough (endpoint 404s). */
  getSetupGuide(provider: ProviderName): Promise<ProviderSetupGuide | null>;
  /**
   * Start an OAuth connect. `state` is minted and stored SERVER-side by the
   * host against the admin session; the browser only carries it onward.
   */
  beginOAuth(
    provider: ProviderName,
    body: { state: string; redirectUri: string; environment?: 'SANDBOX' | 'PRODUCTION' },
  ): Promise<{ url: string; state: string }>;
  disconnectOAuth(provider: ProviderName): Promise<{ disconnected: boolean }>;
}

export function createPaymentsSettingsClient(
  options: PaymentsClientOptions,
): PaymentsSettingsClient {
  const request = makeRequest(options);
  const providerPath = (provider: ProviderName, suffix = ''): string =>
    `/settings/providers/${encodeURIComponent(provider)}${suffix}`;
  return {
    baseUrl: options.baseUrl,
    getSettings: () => request<MerchantSettingsView>('/settings'),
    saveCredentials: (provider, input) =>
      request<MaskedProviderConfig>(providerPath(provider), {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    setEnabled: (provider, enabled) =>
      request<MaskedProviderConfig>(providerPath(provider, '/enabled'), {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      }),
    setFailoverPolicy: (policy) =>
      request<MerchantSettingsView>('/settings/failover-policy', {
        method: 'PUT',
        body: JSON.stringify({ policy }),
      }),
    setPriorities: (ordered) =>
      request<MerchantSettingsView>('/settings/priorities', {
        method: 'PUT',
        body: JSON.stringify({ providers: ordered }),
      }),
    verify: (provider, environment) =>
      request<VerifiedProviderConfig>(
        providerPath(provider, environment ? `/verify?environment=${environment}` : '/verify'),
        { method: 'POST' },
      ),
    // Deliberately NOT under `/providers/...`: the guide is READ-ONLY public
    // content, while everything under `/providers` writes or tests a
    // credential. Hosts gate the two differently (this repo's agent surface
    // exposes the guide and forbids the writes), which a shared prefix would
    // make impossible to express.
    getSetupGuide: (provider) =>
      request<ProviderSetupGuide>(`/settings/guides/${encodeURIComponent(provider)}`).catch((err: unknown) => {
        if (err instanceof PaymentsClientError && err.status === 404) return null;
        throw err;
      }),
    beginOAuth: (provider, body) =>
      request<{ url: string; state: string }>(providerPath(provider, '/oauth/begin'), {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    disconnectOAuth: (provider) =>
      request<{ disconnected: boolean }>(providerPath(provider, '/oauth/disconnect'), {
        method: 'POST',
      }),
  };
}
