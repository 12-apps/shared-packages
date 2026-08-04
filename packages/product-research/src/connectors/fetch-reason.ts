import type { ConnectorContext, FetchFailure, FetchInit, FetchOutcome } from './types';

/**
 * The failure-reason seam every connector reads a GET through (FUT-495).
 *
 * Production case that motivated it: a tenant's Atacadão VTEX source showed
 * only "indisponível", with `VTEX catalog search unreachable: <url>` stored.
 * The URL proved the guarded transport HAD followed the apex→www redirect and
 * the source failed in ~1.3s — well inside the timeout — so it was a fast
 * refusal, not an outage. Nobody could tell a 403 bot-block from a 404, a 5xx
 * or a TLS failure, because the transport collapsed all of them to `null`.
 *
 * Two jobs, kept together because they are the same sentence: read the GET
 * through the richest transport the host mounted, and turn what came back into
 * pt-BR an operator can act on.
 */

/**
 * The diagnostic form of a URL: origin + path, NEVER the query string. The
 * endpoint that failed is the useful half; the query can carry a tenant key
 * (and `?ft=` search terms are noise in an error message anyway).
 */
export const diagnosticUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '(endereço inválido)';
  }
};

/** What an HTTP status means for a store search, in the operator's terms. */
const httpReason = (status: number): string => {
  if (status === 401 || status === 403) {
    return `a loja recusou nosso acesso (HTTP ${status} — bloqueio de bot ou de IP)`;
  }
  if (status === 404) return 'o endereço não existe na loja (HTTP 404) — confira a URL';
  if (status === 429) return 'a loja limitou nossa taxa de consultas (HTTP 429 — consultas demais)';
  if (status >= 500) {
    return `a loja está com erro interno (HTTP ${status}) — pode ser instabilidade momentânea`;
  }
  return `a loja recusou a consulta (HTTP ${status})`;
};

/**
 * The code the host reports for a request it REFUSED to continue because the
 * redirect would have dropped its credential headers (FUT-520). Named here
 * because this module gives it its sentence; the host names the same literal,
 * exactly as it does for `DNS_UNRESOLVED` and `REDIRECT_REFUSED`.
 */
export const CREDENTIALS_STRIPPED = 'CREDENTIALS_STRIPPED';

/**
 * Transport codes that deserve their own sentence instead of being appended raw.
 * A name that does not resolve is a TYPO in the source's URL, not an outage and
 * not a policy block — the difference between "fix the address" and "file a
 * support ticket", so it must not read as `(rede, DNS ou TLS: ENOTFOUND)`.
 *
 * `CREDENTIALS_STRIPPED` is the same argument one step further: nothing failed
 * on the network at all — we declined to send the request unauthenticated — and
 * the fix is a FIELD the operator controls, so it must not read as a network
 * failure either.
 */
const CODED_TRANSPORT_REASONS: Readonly<Record<string, string>> = {
  DNS_UNRESOLVED: 'o domínio da loja não foi encontrado (DNS) — confira o endereço da fonte',
  ENOTFOUND: 'o domínio da loja não foi encontrado (DNS) — confira o endereço da fonte',
  EAI_AGAIN: 'a consulta de DNS do domínio da loja falhou — pode ser instabilidade momentânea',
  [CREDENTIALS_STRIPPED]:
    'a loja redireciona para outro endereço e a chave de aplicação não pode viajar junto — ' +
    'configure na fonte o endereço final da loja (normalmente o "www")',
};

/** The transport arm: a known code's own sentence, or the generic clause. */
const transportReason = (code: string | undefined): string => {
  if (code === undefined) return 'falha de conexão com a loja (rede, DNS ou TLS)';
  return (
    CODED_TRANSPORT_REASONS[code] ?? `falha de conexão com a loja (rede, DNS ou TLS: ${code})`
  );
};

/**
 * One pt-BR clause saying why the GET failed. Deliberately a CLAUSE, not a
 * sentence: connectors compose it with what they were doing at the time (which
 * of the VTEX tiers, which endpoint), and that composition is the message the
 * operator reads on the run screen.
 */
export const describeFetchFailure = (failure: FetchFailure): string => {
  if (failure.kind === 'http') return httpReason(failure.status);
  if (failure.kind === 'body') {
    return (
      `a loja respondeu (HTTP ${failure.status}) mas não em JSON — ` +
      'provável página de erro ou de bloqueio'
    );
  }
  if (failure.kind === 'timeout') return 'a loja não respondeu dentro do tempo limite';
  // NOT the transport arm below, and not the timeout arm above: the store never
  // received this request. Blaming it would be the same wrong-operator-message
  // FUT-495 exists to remove, one step earlier — someone would go check a store
  // that is perfectly healthy. Names no endpoint and no url: this text is
  // stored and rendered, and a source URL can carry a key in its query.
  if (failure.kind === 'deadline') {
    return 'a busca nesta fonte atingiu o tempo total permitido antes desta consulta';
  }
  return transportReason(failure.code);
};

/** A status-carrying exchange read as an outcome — the middle host tier. */
const fromStatus = (answer: { status: number; payload: unknown | null } | null): FetchOutcome => {
  if (answer === null) return { ok: false, failure: { kind: 'transport' } };
  if (answer.status < 200 || answer.status >= 300) {
    return { ok: false, failure: { kind: 'http', status: answer.status } };
  }
  return answer.payload === null
    ? { ok: false, failure: { kind: 'body', status: answer.status } }
    : { ok: true, payload: answer.payload };
};

/**
 * GET a JSON document through the most precise transport the host mounted:
 * `fetchJsonResult` (full reasons) → `fetchJsonStatus` (statuses, so at least a
 * 403 stays tellable) → `fetchJson` (one `null`, reported as an undetermined
 * transport failure). Connectors call THIS instead of `ctx.fetchJson`, so a
 * host that has not adopted the seam degrades in precision, never in behaviour.
 *
 * `init` travels UNTOUCHED to whichever tier answers — including the per-call
 * `timeoutMs` budget (FUT-502), so a connector that declares its vendor's
 * measured latency is honoured on every tier that supports it and simply runs
 * on the host default on one that does not.
 */
export const fetchJsonOutcome = async (
  ctx: ConnectorContext,
  url: string,
  init?: FetchInit,
): Promise<FetchOutcome> => {
  if (ctx.fetchJsonResult) return ctx.fetchJsonResult(url, init);
  if (ctx.fetchJsonStatus) return fromStatus(await ctx.fetchJsonStatus(url, init));
  const payload = await ctx.fetchJson(url, init);
  return payload === null
    ? { ok: false, failure: { kind: 'transport' } }
    : { ok: true, payload };
};
