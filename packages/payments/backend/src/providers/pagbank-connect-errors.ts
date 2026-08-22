/**
 * PagBank's Connect (OAuth2) error vocabulary, named.
 *
 * Every one of these arrived as an opaque number attached to an HTTP status,
 * and the cost of that is not hypothetical: `41008` means *the Bearer token in
 * the Authorization header is invalid* — the PLATFORM's account token — but it
 * reads as "your client credentials are wrong", so it sent an investigation
 * auditing a `client_id`/`client_secret` pair that were correct all along. The
 * tell was that the answer never changed no matter what id/secret were sent,
 * including none at all, because it is raised before they are examined.
 *
 * The 4101x family is a second trap. Those are not about our request at all —
 * they are about the PUBLIC-KEY URL registered against our application, i.e.
 * the Connect-challenge endpoint we serve. Nothing else in the system would
 * ever say so.
 *
 * Table source: developer.pagbank.com.br `reference/codigos-de-erro-connect`.
 *
 * ## English, and NOT a copy port (FUT-760)
 *
 * These sentences were Portuguese, and moving them behind required copy config
 * would have been the wrong repair. They are not product copy: no store owner
 * is meant to act on `41008`, and no host would ever want to author a gloss of
 * another company's OAuth error table. Their reader is whoever is debugging a
 * broken Connect integration — they land in a log line and, beside PagBank's
 * own untranslated response, in the raw-exchange detail support asks for. Half
 * of them name env vars and endpoints (`PAGBANK_TOKEN`, `/oauth2/refresh`).
 *
 * So the repair is the repo's own rule rather than a port: what a DEVELOPER
 * reads is English. The vendor's error `name` stays exactly as PagBank sends
 * it, because that is the string to search their documentation for.
 */

interface ConnectError {
  /** PagBank's own name for it — the string that rides with the code. */
  name: string;
  /** What it actually means, for the log line someone has to act on. */
  meaning: string;
}

const CONNECT_ERRORS: Readonly<Record<string, ConnectError>> = {
  '41001': { name: 'invalid_request', meaning: 'a required parameter is missing or invalid.' },
  '41002': { name: 'invalid_redirect_uri', meaning: 'the redirect URL is malformed.' },
  '41003': { name: 'invalid_client', meaning: 'client identification failed (client_id/secret).' },
  '41004': {
    name: 'invalid_grant',
    meaning:
      'the authorization code or refresh token is invalid, has expired, was already ' +
      'consumed, or does not belong to this user.',
  },
  '41005': {
    name: 'unsupported_grant_type',
    meaning:
      'only the authorization_code and refresh_token grants are supported — check the ' +
      'ENDPOINT too: renewal uses /oauth2/refresh, not /oauth2/token.',
  },
  '41006': { name: 'unauthorized_client', meaning: 'the client may not perform this action.' },
  '41007': {
    name: 'unsupported_token_type',
    meaning: 'on revocation, only access_token and refresh_token are accepted.',
  },
  '41008': {
    name: 'invalid_token',
    meaning:
      'the Bearer in the Authorization header is invalid — it is the PLATFORM ACCOUNT ' +
      'TOKEN, not the client_id/client_secret (PAGBANK_TOKEN / PAGBANK_TOKEN_PROD).',
  },
  '41012': {
    name: 'token_is_no_longer_active',
    meaning: 'the token was already used, or does not belong to this user.',
  },
  '41013': {
    name: 'not_found_url',
    meaning: 'no URL is configured for this client — register the public-key URL.',
  },
  '41014': {
    name: 'not_found_public_key',
    meaning: 'the configured URL did not return the expected result (public-key endpoint).',
  },
  '41015': { name: 'invalid_format_url', meaning: 'the configured URL has an incorrect format.' },
  '41016': { name: 'invalid_public_key', meaning: 'the public key found is not valid.' },
};

/**
 * Find a Connect error in whatever PagBank sent back.
 *
 * Deliberately a SEARCH over the raw payload rather than a read of a known
 * field: the published table gives codes and names but not the envelope that
 * carries them, and the only shape seen in the wild was the text
 * `401 41008 invalid_token`. Matching the code as a standalone token is robust
 * to an envelope we have not verified, and silent when nothing matches — these
 * five-digit values are distinctive enough that a false positive would need a
 * payload carrying a bare `410xx` meaning something else.
 *
 * Returns a sentence someone can act on, or null when no known code appears.
 */
export function pagbankConnectError(payload: string): string | null {
  for (const [code, error] of Object.entries(CONNECT_ERRORS)) {
    if (!new RegExp(`\\b${code}\\b`).test(payload)) continue;
    return `${code} ${error.name} — ${error.meaning}`;
  }
  return null;
}
