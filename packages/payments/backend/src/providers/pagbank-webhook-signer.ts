import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * The FUT-678 measurement, as runnable code: which account signs a Connect
 * store's webhook delivery.
 *
 * PagBank documents `x-authenticity-token` as SHA-256 of
 * `{account token}-{payload}` — and never says WHICH account under Connect:
 * the connected store's own token, the platform's, the stored webhookToken
 * override, or the application `client_secret`. The adapter's verify accepts
 * `webhookToken ?? token` on the strength of a hypothesis (`pagbank.ts`), and
 * the sub-epic's audit reopened FUT-678 because nothing ever measured it.
 *
 * The measurement is a COMPARISON, not a network act. The durable webhook
 * inbox already stores every delivery's raw body and headers, so any Connect
 * store's first real notification is enough: feed the captured delivery and
 * every candidate secret in, read the matching label out, paste the verdict
 * on the ticket. Pure and offline on purpose — it can run against production
 * data without touching PagBank, and a non-match is still evidence because
 * every candidate's digest comes back for the record.
 *
 * Ships at its own top-level subpath (like `pagbank-legacy-notifications`):
 * it value-imports `node:crypto`, the root entry is value-imported by the
 * frontend's stories, and `./providers/*` is contractually adapter modules
 * only.
 */

/** One secret the delivery MIGHT have been signed with, and where it lives. */
export interface SignerCandidate {
  /**
   * Where this secret comes from, in operator words — 'store token (SANDBOX)',
   * 'platform token', 'webhookToken override', 'application client_secret'.
   * The label IS the answer when its digest matches, so it must name the
   * account, not an env var.
   */
  label: string;
  secret: string;
}

export interface SignerDiagnosis {
  /** The `x-authenticity-token` the delivery presented, or null when absent. */
  presented: string | null;
  /** Labels whose digest equals the presented token — the measured signer(s). */
  matches: string[];
  /** Every candidate's digest, so a non-match is still pasteable evidence. */
  digests: Record<string, string>;
}

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

const equalsPresented = (digest: string, presented: string): boolean => {
  const a = Buffer.from(digest);
  const b = Buffer.from(presented.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Case-insensitive header lookup — captured rows differ in casing by source. */
const presentedToken = (headers: Record<string, string | undefined>): string | null => {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'x-authenticity-token' && typeof value === 'string' && value !== '') {
      return value;
    }
  }
  return null;
};

/**
 * Compare a captured delivery against every candidate secret.
 *
 * The raw body must be the exact bytes PagBank posted — a re-serialized JSON
 * body hashes differently, which is also why the inbox row (not a parsed
 * copy) is the right input.
 */
export function diagnoseWebhookSigner(
  delivery: { headers: Record<string, string | undefined>; rawBody: string },
  candidates: SignerCandidate[],
): SignerDiagnosis {
  const presented = presentedToken(delivery.headers);
  const digests: Record<string, string> = {};
  const matches: string[] = [];
  for (const { label, secret } of candidates) {
    const digest = sha256Hex(`${secret}-${delivery.rawBody}`);
    digests[label] = digest;
    if (presented !== null && equalsPresented(digest, presented)) matches.push(label);
  }
  return { presented, matches, digests };
}
