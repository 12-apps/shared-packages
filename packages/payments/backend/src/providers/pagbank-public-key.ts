/**
 * PagBank's card-encryption public key, minted on demand (FUT-761, ported
 * from the future-pay host — FUT-174's per-store key rule).
 *
 * The key handed to the browser SDK MUST belong to the same merchant account
 * the charge lands in: PagBank rejects a card encrypted under another
 * account's key, which is why a shared platform key can never serve
 * per-store checkouts and why an OAuth-connected store — which never pastes
 * a key — needs one FETCHED with its own token. The vendor call
 * (`POST /public-keys` `{type:"card"}`) is adapter knowledge and lives here;
 * WHERE the fetched key is cached (the host's encrypted credential rows) and
 * WHEN to fall back stay host policy behind its `BrowserKeyPort`.
 *
 * Best-effort by contract: `null` on a missing token, a network failure or
 * any non-2xx — a checkout that falls back to the mock/pasted key must never
 * be blocked by this read. A pre-send network failure (fetch's `TypeError`)
 * is retried; it mints no charge, so the retry is safe.
 *
 * Ships at its own top-level subpath (like `pagbank-legacy-notifications`):
 * the root entry is value-imported by the frontend's stories, and
 * `./providers/*` is contractually adapter modules only.
 */

interface PagBankPublicKeyResponse {
  public_key?: unknown;
}

export interface PagbankPublicKeyConfig {
  /** e.g. https://api.pagseguro.com or the sandbox base. */
  apiBase: string;
  /** The MERCHANT's own token — never the platform's (see module doc). */
  token: string | null | undefined;
}

const RETRIES = 2;
const RETRY_DELAY_MS = 300;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchPagbankCardPublicKey(
  config: PagbankPublicKeyConfig,
): Promise<string | null> {
  if (!config.token) return null;
  let base = config.apiBase;
  // Regex-free trailing-slash trim — CodeQL flags `/\/+$/` as polynomial on
  // repeated '/', and a loop of slices is O(n) with no pattern to reason about.
  while (base.endsWith('/')) base = base.slice(0, -1);
  const url = `${base}/public-keys`;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({ type: 'card' }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as PagBankPublicKeyResponse;
      const key = typeof body.public_key === 'string' ? body.public_key.trim() : '';
      return key !== '' ? key : null;
    } catch (error) {
      // Only a pre-send network failure is worth another try; anything else
      // (a body that is not JSON, an abort) is this call's answer.
      if (!(error instanceof TypeError) || attempt >= RETRIES) return null;
      await wait(RETRY_DELAY_MS * (attempt + 1));
    }
  }
}
