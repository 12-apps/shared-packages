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
 */

interface ConnectError {
  /** PagBank's own name for it — the string that rides with the code. */
  name: string;
  /** What it actually means, for a log line someone has to act on. */
  meaning: string;
}

const CONNECT_ERRORS: Readonly<Record<string, ConnectError>> = {
  '41001': {
    name: 'invalid_request',
    meaning: 'um parâmetro obrigatório está ausente ou tem valor inválido.',
  },
  '41002': { name: 'invalid_redirect_uri', meaning: 'a URL de redirecionamento está malformada.' },
  '41003': { name: 'invalid_client', meaning: 'a identificação do cliente falhou (client_id/secret).' },
  '41004': {
    name: 'invalid_grant',
    meaning:
      'o código de autorização ou o refresh token é inválido, expirou, já foi consumido, ' +
      'ou não pertence a este usuário.',
  },
  '41005': {
    name: 'unsupported_grant_type',
    meaning:
      'apenas os grants authorization_code e refresh_token são suportados — confira também o ' +
      'ENDPOINT: a renovação usa /oauth2/refresh, não /oauth2/token.',
  },
  '41006': { name: 'unauthorized_client', meaning: 'o cliente não tem permissão para esta ação.' },
  '41007': {
    name: 'unsupported_token_type',
    meaning: 'na revogação, apenas access_token e refresh_token são aceitos.',
  },
  '41008': {
    name: 'invalid_token',
    meaning:
      'o Bearer do header Authorization é inválido — é o TOKEN DA CONTA da plataforma, ' +
      'não o client_id/client_secret (PAGBANK_TOKEN / PAGBANK_TOKEN_PROD).',
  },
  '41012': {
    name: 'token_is_no_longer_active',
    meaning: 'o token já foi usado ou não pertence a este usuário.',
  },
  '41013': {
    name: 'not_found_url',
    meaning: 'nenhuma URL está configurada para este client — registre a URL de chave pública.',
  },
  '41014': {
    name: 'not_found_public_key',
    meaning: 'a URL configurada não devolveu o resultado esperado (endpoint de chave pública).',
  },
  '41015': { name: 'invalid_format_url', meaning: 'a URL configurada está com formato incorreto.' },
  '41016': { name: 'invalid_public_key', meaning: 'a chave pública encontrada não é válida.' },
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
