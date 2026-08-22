import type { SourceBudgetCopy } from '../connectors/diagnostics-copy';
import type { ConnectorContext, FetchInit, FetchOutcome } from '../connectors/types';

/**
 * The per-source WALL-CLOCK ceiling (FUT-516).
 *
 * Every exchange was already honestly bounded — 10s per hop, twice that per
 * redirect walk — but nothing bounded a SOURCE. `vtexConnector.search` can
 * issue six exchanges (regions probe, intelligent-search, its EAN→text
 * fallback, the legacy catalog search, ITS fallback, the delivery simulation),
 * ~120s worst case, and `research.run` retries three times: ~360s of worker
 * time on one buyer's request.
 *
 * Enforced in the TRANSPORT, not with a `Promise.race`, and that choice is the
 * design:
 * - a race would leave the losing connector running — its sockets, its paid
 *   calls and its logging all continue — and would throw away the offers it
 *   had already collected;
 * - stamping the deadline on every seam instead makes the connector UNWIND
 *   NATURALLY. A refused seam is the same thing a connector already handles
 *   when a host does not mount that seam at all (`regionProducts` → null,
 *   `resolveVtexRegion` → unknown, `deliverableSkus` → "make no delivery
 *   claim"), so it returns whatever it already has. That is why a truncated
 *   source KEEPS its partial offers instead of losing them.
 *
 * Wrapping the CONTEXT rather than each connector is the doctrine
 * `./rate-limit.ts` already states next door: it is the one place that covers
 * connectors not written yet.
 */

/** The instant a source that started at `startedAtMs` must be done by. */
export const sourceDeadlineAt = (startedAtMs: number, budgetMs: number): number =>
  startedAtMs + budgetMs;

/** True once the ceiling has passed — a pure predicate, read after the fact. */
export const hitCeiling = (deadlineAt: number): boolean => Date.now() >= deadlineAt;

/**
 * What a source that blew its ceiling records. NAMES NOTHING about the request:
 * no url, no endpoint, no query string. A source URL is tenant-authored config
 * and can carry a key in its query (the FUT-496 rule), and this text is STORED
 * on the run and RENDERED on the run screen and in the superadmin inbox.
 *
 * It also blames us rather than the store, because that is what happened: the
 * store was never given the chance to answer this part.
 */
export const sourceCeilingError = (copy: SourceBudgetCopy): string => copy.ceilingReached;

/** The deadline stamped onto whatever the connector asked for, `timeoutMs` intact. */
const withDeadline = (init: FetchInit | undefined, deadlineAt: number): FetchInit => ({
  ...init,
  deadlineAt,
});

/** The refusal a reason-carrying seam gives once the ceiling is spent. */
const refused = (): FetchOutcome => ({ ok: false, failure: { kind: 'deadline' } });

/**
 * Wrap a connector context so every outbound seam carries the source's ceiling
 * and, once it is spent, short-circuits WITHOUT touching the network.
 *
 * The short-circuit is belt and braces rather than the mechanism: the host
 * transport refuses a spent deadline by itself. It is here because a seam a
 * host mounts over something other than the guarded transport (a fixture, a
 * second host) would otherwise still fire, and because refusing in-process
 * costs nothing at all.
 *
 * The reason-carrying seams say WHY (`{kind:'deadline'}`); the legacy ones have
 * no vocabulary for a reason at all and answer the same `null` they answer for
 * every other failure. Telling a deadline apart is precisely what mounting the
 * reason seam buys — the trade `fetchJsonOutcome` already documents.
 */
export const budgetedContext = (ctx: ConnectorContext, deadlineAt: number): ConnectorContext => {
  const wrapped: ConnectorContext = {
    ...ctx,
    fetchJson: (url, init) =>
      hitCeiling(deadlineAt)
        ? Promise.resolve(null)
        : ctx.fetchJson(url, withDeadline(init, deadlineAt)),
  };
  const fetchJsonResult = ctx.fetchJsonResult?.bind(ctx);
  if (fetchJsonResult) {
    wrapped.fetchJsonResult = (url, init) =>
      hitCeiling(deadlineAt)
        ? Promise.resolve(refused())
        : fetchJsonResult(url, withDeadline(init, deadlineAt));
  }
  const fetchJsonStatus = ctx.fetchJsonStatus?.bind(ctx);
  if (fetchJsonStatus) {
    wrapped.fetchJsonStatus = (url, init) =>
      hitCeiling(deadlineAt)
        ? Promise.resolve(null)
        : fetchJsonStatus(url, withDeadline(init, deadlineAt));
  }
  const postForm = ctx.postForm?.bind(ctx);
  if (postForm) {
    wrapped.postForm = (url, form, init) =>
      hitCeiling(deadlineAt)
        ? Promise.resolve(null)
        : postForm(url, form, withDeadline(init, deadlineAt));
  }
  const postJsonResult = ctx.postJsonResult?.bind(ctx);
  if (postJsonResult) {
    wrapped.postJsonResult = (url, body, init) =>
      hitCeiling(deadlineAt)
        ? Promise.resolve(refused())
        : postJsonResult(url, body, withDeadline(init, deadlineAt));
  }
  return wrapped;
};
