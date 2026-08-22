import type { ResearchDiagnosticsCopy } from './diagnostics-copy';
import type { LoggerPort } from '../ports';
import type { RawOffer, ResearchQuery, SourceRecord } from '../types';

/**
 * The vendor plug-point. A new store/marketplace = one object implementing
 * this interface (or, for platform connectors like VTEX, one more `config`
 * row). Connectors never throw for expected trouble — an unreachable store
 * returns an error result the pipeline turns into a visible degraded stat.
 *
 * Contract: raw offers must NOT vary with `query.quantity` — results are
 * cached per (source, term, brand, ean, region) and reused across quantities;
 * every quantity-dependent number (packs needed, totals, amortized shipping)
 * is computed by the pipeline.
 */
/**
 * WHY a guarded GET produced no usable JSON document (FUT-495). `fetchJson`
 * collapses every failure into one `null`, which is what left a production
 * source reading "indisponível" with a stored error nobody could act on: a 403
 * bot-block, a 404, a broken TLS handshake and a 10s timeout were one symptom.
 *
 * - `http` — the store ANSWERED, with a status outside 2xx (403/404/429/5xx…).
 * - `body` — 2xx, but the body was not JSON: a challenge page or an error page.
 * - `timeout` — the request (or the redirect chain) ran out of its budget.
 * - `deadline` — WE stopped, not the store: the per-source wall-clock ceiling
 *   (`FetchInit.deadlineAt`, FUT-516) was already spent, so this exchange was
 *   never sent — or was cut at the ceiling rather than at its own budget.
 * - `transport` — nothing was answered at all: DNS, TLS, refused connection, a
 *   destination the host's guard refused, a redirect it would not follow.
 *   `code` is a short machine code (`ENOTFOUND`) when the host could determine
 *   one; it is never a URL, so it can never carry a query string or a key.
 *
 * `deadline` is its OWN member rather than a `transport` code, and that is the
 * whole reason it exists: `transport` is documented right above as "nothing was
 * answered at all", so borrowing it would render a network sentence — "falha de
 * conexão com a loja (rede, DNS ou TLS)" — for a request we CHOSE not to send.
 * That is the class of lie FUT-495 was filed to remove, and it would send an
 * operator to check a store that is perfectly healthy.
 */
export type FetchFailure =
  | { kind: 'http'; status: number }
  | { kind: 'body'; status: number }
  | { kind: 'timeout' }
  | { kind: 'deadline' }
  | { kind: 'transport'; code?: string };

/** A guarded GET's answer: the parsed document, or why there isn't one. */
export type FetchOutcome =
  | { ok: true; payload: unknown }
  | { ok: false; failure: FetchFailure };

/**
 * Per-call options for a host fetch: the headers this request needs, and the
 * budget it should run under.
 *
 * `timeoutMs` is the PER-CONNECTOR budget (FUT-502). One global constant in the
 * host was wrong in both directions: SearchApi's `google_shopping` engine
 * routinely answers in 8–10s, so a 10s ceiling failed it intermittently (and
 * each failure burned a paid credit), while a dead store must NOT be allowed to
 * hang for that long just because a paid API is slow. A connector that knows
 * its vendor's measured latency declares it here; one that passes nothing keeps
 * the host's default, unchanged.
 *
 * It is a REQUEST, not a command: the engine states a duration in milliseconds
 * and the host — the only layer that knows about AbortController, redirect
 * walks and its own ceilings — decides what to arm, clamping anything absurd.
 */
export interface FetchInit {
  headers?: Record<string, string>;
  /**
   * How long ONE request may take before the host aborts it, in ms. Absent =
   * the host's default budget. A host is free to clamp it into a sane range.
   */
  timeoutMs?: number;
  /**
   * The instant (epoch ms) no part of this exchange may run past — the WHOLE
   * source's wall-clock ceiling, not this request's (FUT-516). `timeoutMs`
   * bounds one exchange; a connector free to issue six of them was still
   * unbounded, so the pipeline stamps this on every seam and the host takes
   * `min(its own chain ceiling, deadlineAt)`.
   *
   * A REQUEST like `timeoutMs`, under the same doctrine: the engine states an
   * instant and the host — the only layer that knows about AbortController and
   * redirect walks — decides what to arm. Absent = no source ceiling in force,
   * which is exactly how every embedder that never sets one keeps behaving.
   */
  deadlineAt?: number;
  /**
   * This exchange is MEANINGLESS without its credential headers (FUT-520). A
   * REQUEST like `timeoutMs`: the connector states the dependency and the host
   * — the only layer that knows about redirect walks — decides what to do.
   *
   * The failure it prevents: credential headers are dropped when a redirect
   * changes host, silently. Without this flag a keyed request continues
   * ANONYMOUSLY (a real store's chain is apex → www) and its refusal is then
   * reported as a plain block, which "proves" the credential does nothing.
   */
  credentialsRequired?: boolean;
}

export interface ConnectorContext {
  logger: LoggerPort;
  /**
   * Every sentence this connector puts in front of a store owner when the
   * source fails (FUT-760).
   *
   * On the CONTEXT rather than as a parameter on each helper, because this is
   * the object that already reaches every diagnostic call site — a connector
   * holds a `ctx` precisely so a host can supply what only a host knows. The
   * package ships no default: `PT_BR_RESEARCH_DIAGNOSTICS` is the wording it
   * used to compile in, now chosen by name.
   */
  diagnostics: ResearchDiagnosticsCopy;
  /** Never-throw JSON fetch the host provides (timeout, identified UA). */
  fetchJson(url: string, init?: FetchInit): Promise<unknown | null>;
  /**
   * Never-throw JSON GET that reports WHY it failed (FUT-495) — the seam that
   * lets a connector record "a loja recusou nosso acesso (HTTP 403)" instead of
   * a blanket "unreachable". Optional: a host that does not mount it leaves
   * `fetchJsonOutcome` to fall back on `fetchJsonStatus` and finally on
   * `fetchJson`'s single `null` (reported as an undetermined transport
   * failure), so a connector written against this seam keeps working — just
   * less precisely — and every existing host keeps compiling.
   */
  fetchJsonResult?(url: string, init?: FetchInit): Promise<FetchOutcome>;
  /**
   * Never-throw JSON GET that also reports the HTTP status — what a save-time
   * credential check needs to tell "the provider REJECTED this key" (401/403)
   * from "the provider is unreachable" (`null`). `payload` is the parsed body,
   * `null` when it wasn't JSON. Optional: hosts without it keep compiling, and
   * a connector must then treat every failure as unverifiable, never as a
   * definitive rejection.
   */
  fetchJsonStatus?(
    url: string,
    init?: FetchInit,
  ): Promise<{ status: number; payload: unknown | null } | null>;
  /**
   * Never-throw form-encoded POST returning parsed JSON — the shape OAuth
   * token endpoints speak (Mercado Livre). Optional: a host with no
   * token-gated connector mounted needs no POST transport, and a connector
   * that requires it must degrade, not throw, when the host omits it.
   */
  postForm?(
    url: string,
    form: Record<string, string>,
    init?: FetchInit,
  ): Promise<unknown | null>;
  /**
   * Never-throw JSON POST that reports WHY it failed (FUT-514). The GET seams
   * above cannot ask every question a connector has: VTEX answers "does this
   * SKU reach this CEP" only on `orderForms/simulation`, a POST with a body.
   * Optional like the seams beside it — a host that does not mount it leaves
   * the connector unable to VERIFY deliverability, which must degrade to
   * claiming nothing, never to guessing. A wrong delivery claim is worse than
   * no claim: it is what FUT-514 was filed to remove.
   */
  postJsonResult?(url: string, body: unknown, init?: FetchInit): Promise<FetchOutcome>;
}

export type ConnectorResult =
  | {
      ok: true;
      offers: RawOffer[];
      /**
       * The store does not deliver to the queried region and these offers are
       * its DEFAULT region's (FUT-495). Declared by the connector because it is
       * the only thing that knows — deriving it from `offers.some(flag)` reports
       * NO caveat for a not-served store whose default catalog matched nothing,
       * which is exactly when the buyer most needs to be told. Absent means the
       * connector has no such claim; the pipeline then falls back to the flags
       * on the offers themselves (what a cached answer carries).
       */
      outsideDeliveryArea?: boolean;
    }
  | { ok: false; error: string };

/** Outcome of a connector's cheap save-time credential test call. */
export type CredentialCheck = { ok: true } | { ok: false; error: string };

/**
 * Outcome of a connector's cheap save-time CONFIG probe (FUT-492). Same shape
 * as `CredentialCheck`, different subject: not "does this key authenticate"
 * but "does the store this config points at actually answer as the API this
 * connector speaks". `error` is shown verbatim to the operator, so it must be
 * pt-BR and say what to change (or that a retry is worth it).
 */
export type SourceConfigCheck = { ok: true } | { ok: false; error: string };

export interface PriceSourceConnector {
  readonly type: string;
  /**
   * False for connectors whose data is already local (e.g. MANUAL price
   * lists): the pipeline skips the result cache entirely, so an updated
   * import is visible in the very next research instead of after the TTL.
   * Absent means cacheable — the right default for anything network-backed.
   */
  readonly cacheable?: boolean;
  /**
   * The spend pool this connector's paid calls drain. Connectors riding the
   * SAME paid vendor account declare the same scope (SERP and AMAZON both
   * ride SearchApi.io), so one budget cap covers the whole invoice instead
   * of each source type minting its own allowance. Absent means the source
   * type is its own pool.
   */
  readonly budgetScope?: string;
  search(query: ResearchQuery, source: SourceRecord, ctx: ConnectorContext): Promise<ConnectorResult>;
  /**
   * Optional cheap test call proving a tenant credential works, run by the
   * host when the credential is SAVED — never during a research. `ok: false`
   * means the provider DEFINITIVELY rejected the credential and the save is
   * refused; `null` means the connector could not verify (provider outage,
   * host transport without statuses) — the save proceeds with a visible
   * unverified status and the first run degrades visibly if the key is bad.
   * Absent means the host cannot verify at all and stores the credential
   * with the same unverified status.
   */
  validateCredentials?(
    credentials: Record<string, string>,
    ctx: ConnectorContext,
  ): Promise<CredentialCheck | null>;
  /**
   * Optional cheap LIVE probe of a source's `config`, run by the host when the
   * source is CREATED or EDITED — never during a research (FUT-492). It exists
   * so a store that cannot answer is refused at the moment it is connected,
   * instead of sitting DEGRADED and burning a day of dead runs.
   *
   * `ok: false` refuses the save and the `error` is what the operator reads —
   * so the connector, not the host, decides how to phrase every failure
   * (invalid URL, silent store, wrong kind of API) and whether a retry could
   * help. `null` means the connector formed no opinion about this config and
   * the save proceeds untouched. Absent means the type has nothing live to
   * validate at all (MANUAL price lists) — the host then skips the probe.
   */
  validateSourceConfig?(
    config: Record<string, unknown>,
    ctx: ConnectorContext,
  ): Promise<SourceConfigCheck | null>;
}
