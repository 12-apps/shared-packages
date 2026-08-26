/**
 * What the shell's backend surface needs from a host, and nothing more (12-18).
 *
 * Mirrors the report-builder / rbac / audit shape: framework-neutral request and
 * response, a resolved actor the package never computes, and a db-shaped seam it
 * never reaches around. Two things are worth stating explicitly here, because both
 * are places a defaulted knob would fail OPEN:
 *
 *  - {@link ConsentSeam.isCurrent} is REQUIRED. A default of "yes, they accepted"
 *    means a version bump never prompts anybody, which is precisely the production
 *    failure this surface exists to end — and it would look identical to working.
 *  - {@link ConsentSeam.record} must PROPAGATE its failure. A host that swallows it
 *    answers 204 while leaving the caller stale, so the browser clears the prompt
 *    and the caller stays locked out of every guard with no signal to retry.
 *
 * There is no default `termsVersion` either. A version string is a fact about a
 * host's own legal documents; inventing one would silently stamp acceptances of a
 * document nobody wrote.
 *
 * And a third, which is about the 500 the second one deliberately produces:
 * {@link AppShellServerConfig.onUnexpectedError} is where it gets REPORTED. The
 * package has no logger and must not acquire one, so silence is what a host gets
 * until it wires that key — see its own docstring for why that is the one default
 * worth being loud about in a review.
 */
import { resolveAppShellCopy, type AppShellCopySource } from '../core/copy';

/**
 * One request, as this surface sees it — framework-neutral.
 *
 * `raw` is the adapter's own context object (a Hono `Context`, an Express `req`…).
 * It exists for {@link AppShellServerConfig.consent}'s `resolveActor` alone:
 * reading a session cookie is host work, and a host must not have to
 * re-implement it against a normalized shape. No handler in this package touches
 * it.
 */
export interface AppShellRequest {
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  header(name: string): string | undefined;
  raw?: unknown;
  /**
   * The language to answer this caller in, as a language tag (`pt-BR`,
   * `en-US`) — the same field `@12-apps/wiring`'s `WireRequest` carries, and
   * the field `manifest/server` copies across from it.
   *
   * Populated by the host's adapter, which is the only layer that can
   * negotiate one. Absent is meaningful and not an error: a host with one
   * audience never sets it, and this surface must then answer with the words
   * it was configured with rather than invent a language.
   *
   * Deliberately NOT read off `header('accept-language')` here. Negotiation is
   * the host's — it owns the precedence order (an explicit `?lang=`, a
   * remembered cookie, a stored preference) and this surface would only ever
   * see the last of those, so a package-side read would quietly outrank a
   * choice the reader already made. `./hono` takes a `resolveLocale(c)` seam
   * for exactly that answer; the wiring mount needs none.
   */
  locale?: string;
}

/** A cookie the surface asks the adapter to set on its response. */
export interface AppShellCookie {
  name: string;
  value: string;
  /** Seconds. */
  maxAge: number;
  path: string;
  httpOnly: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  secure: boolean;
}

/** What a handler answers with; the adapter maps this onto its response type. */
export interface AppShellResponse {
  status: number;
  /** `undefined` means NO body at all (204) — not the same as `null`. */
  body: unknown;
  /** Cookies the adapter must attach. Empty for every read. */
  cookies?: readonly AppShellCookie[];
}

export interface AppShellRoute {
  method: 'GET' | 'POST';
  /** Path relative to the host's mount, in `:param` form. */
  path: string;
  handle(request: AppShellRequest): Promise<AppShellResponse>;
}

/**
 * Who is asking. `null` means anonymous, which answers `stale: false` and records
 * nothing — a signed-out visitor is not overdue for anything.
 *
 * The package derives none of this: the host resolves its own session and hands
 * over an opaque-to-us identity, which is then the only thing the two seams below
 * are called with.
 */
export interface ConsentActor {
  /** The caller's user id. */
  userId: string;
  /** Anything else the host's seams need — carried through untouched. */
  [key: string]: unknown;
}

export type ResolveConsentActor = (
  request: AppShellRequest,
) => Promise<ConsentActor | null> | ConsentActor | null;

/**
 * The signed handoff cookie, for a host whose sign-up flow accepts the terms
 * BEFORE an account exists.
 *
 * Optional as a whole, because a host with no pre-account consent step needs
 * none. But `sign` has no default: the value is only trustworthy because it is
 * HMAC-signed with a secret the browser never has, and a package-supplied signer
 * would either need that secret or produce a token anyone could forge from
 * `document.cookie`.
 */
export interface ConsentCookieConfig {
  /** Cookie name, e.g. `signup_terms`. */
  name: string;
  /** Sign `version` with an absolute expiry, using the HOST's secret. */
  sign(version: string, expiresAtMs: number): string;
  /** Lifetime in ms. Long enough for an OAuth round trip; short overall. */
  ttlMs?: number;
  /**
   * `Secure` flag. Defaults to **true** — pass `false` only for a plain-HTTP dev box.
   *
   * The package cannot read a host's `NODE_ENV`, so silence has to point somewhere, and
   * a security flag whose default is off means the adopter who never thought about it
   * ships a plaintext consent token. The opt-out fails loudly and locally instead: over
   * HTTP the browser refuses to store a `Secure` cookie, so the sign-up handoff breaks
   * on the developer's first try rather than in production.
   */
  secure?: boolean;
}

/**
 * Where consent state lives.
 *
 * Deliberately NOT a Prisma model of ours. "Has this user accepted version X" is a
 * fact about the host's own identity row (a typical host stamps something like
 * `User.termsAcceptedAt` / `User.termsVersion`, and its guards read the same
 * predicate) — so a model here would be a second, competing answer to a question
 * the host's user table already answers. See ADOPTING.md.
 */
export interface ConsentSeam {
  resolveActor: ResolveConsentActor;
  /**
   * Has this actor accepted `version`? REQUIRED, and required so the gate fails
   * CLOSED: an unimplemented seam prompts everybody rather than nobody.
   *
   * Use the SAME predicate the host's own guards use. A second predicate here is
   * how a surface comes to disagree with the thing actually blocking the caller.
   */
  isCurrent(actor: ConsentActor, version: string): Promise<boolean> | boolean;
  /**
   * Record the acceptance. Idempotent — re-accepting must be a no-op upsert.
   *
   * Let failures THROW: the handler turns them into a 500 on purpose (see
   * `routes.ts`), because a 204 over a failed write tells the caller they are
   * fine while every guard keeps refusing them.
   */
  record(actor: ConsentActor, version: string): Promise<void> | void;
  /**
   * Called after a successful `record`, so the actor's OTHER devices learn about
   * it. Optional, and fire-and-forget: a host wires its realtime publisher here.
   *
   * Ordering is the package's: it fires AFTER the write, so a woken tab that
   * re-asks gets the new answer. Publishing first would race the write and
   * re-block the tab it just freed.
   */
  onAccepted?(actor: ConsentActor): void;
  cookie?: ConsentCookieConfig;
}

/**
 * Server-side copy for the failure body — the HOST's, like every other sentence
 * this package renders. The pt-BR default that used to sit here was one
 * adopter's wording reached by omission; see `react/messages.ts`.
 *
 * There is still no pack in this package, and that is the same decision rather
 * than an unfinished one. These words are wholly the host's, so the PAIR of
 * languages lives where the words do: a host ships `{ 'pt-BR': …, 'en-US': … }`
 * beside its own copy and hands `localeCopy(…)` to
 * {@link AppShellServerConfig.messages}. A pack here would be one adopter's
 * wording again, merely reachable by two names instead of by none.
 */
export interface AppShellServerMessages {
  /** Body of the 500 when the host's `record` threw. */
  recordFailed: string;
}

/** Which descriptor was handling the request when it threw. */
export interface UnexpectedErrorContext {
  method: AppShellRoute['method'];
  /** Path relative to the host's mount, in `:param` form — as declared. */
  path: string;
}

/**
 * Report a failure this surface did not expect, on its way to becoming a 500.
 *
 * Called with the thrown value EXACTLY as caught — a real `Error` where the host's
 * seam threw one — because an error reporter needs a stack and something to group
 * on, and a stringified message gives it neither.
 *
 * Only for the unexpected branch. An {@link AppShellApiError} is a status this
 * surface CHOSE, so folding one is not an incident and nothing is reported.
 *
 * Fire-and-forget, and its own throw is swallowed: a reporter that fails must not
 * replace the status the caller is waiting for.
 */
export type ReportUnexpectedError = (
  error: unknown,
  context: UnexpectedErrorContext,
) => void;

export interface AppShellServerConfig {
  /**
   * The terms version this deployment is on. REQUIRED — see the module docstring.
   * Bump it and every previously-consented caller reads `stale: true`.
   */
  termsVersion: string;
  consent: ConsentSeam;
  /**
   * The failure body's words — a pack, or a RESOLVER that picks one per reader.
   *
   * Read it through {@link messagesOf} at the moment the sentence is needed,
   * never off this field: a resolver reached where a value was expected is a
   * runtime `TypeError`, and the accessor is what makes that a compile error
   * instead.
   *
   * A 500 is read by whoever made the request, so the language is the
   * REQUEST's rather than the deployment's — `appShellRoutes` calls the
   * accessor with {@link AppShellRequest.locale} inside each handler's catch.
   * The mount is built once per process (at least one adopter memoises it), so
   * resolving there would word every refusal that deployment ever emits in the
   * language its boot happened to run in, and a single-locale host could not
   * tell that from correct.
   */
  messages: AppShellCopySource<AppShellServerMessages>;
  /**
   * Where an unexpected throw is reported before it is folded into a 500.
   *
   * OPTIONAL only because a package cannot require a host to own an error reporter,
   * and `console` is not one: in every adopter this surface has, a `console.error`
   * reaches stdout and nothing else, so a 500 logged that way is a 500 nobody is
   * told about. Wire your own — the same channel your other routes report through.
   *
   * This matters most on exactly the path {@link ConsentSeam.record} is documented
   * to fail on. That 500 is deliberate: the alternative is a 204 over a failed
   * write, which tells a user they accepted while every guard keeps refusing them.
   * But a deliberate 500 that nobody can see is only half of that decision — the
   * user is stuck and the operator has nothing to look up. The host that first
   * mounted this surface reached it by dropping its own route wrapper, and the
   * catch-all reporter went with it silently, which is why the seam exists here
   * rather than being left to whatever each adopter wraps around the mount.
   *
   * ```ts
   * onUnexpectedError: (error, { method, path }) =>
   *   log.error(`[consent] ${method} ${path} threw:`, error),
   * ```
   */
  onUnexpectedError?: ReportUnexpectedError;
}

/**
 * What a copy field takes once its words can follow a reader.
 *
 * Re-exported from `../core/copy`, which is where the declaration now lives:
 * the BROWSER half's `messages` took the same widening, and one mirror between
 * the two halves is what stops them drifting into two spellings of the same
 * idea. The names, the shape and this import path are unchanged, so nothing an
 * adopter wrote moves.
 */
export type { AppShellCopyResolver, AppShellCopySource } from '../core/copy';

/**
 * The words this surface is answering with, at the moment one is needed.
 *
 * The ONE place a copy source becomes a value on this half, which is what keeps
 * rule E ("absent stays absent") a property of this package rather than of each
 * call site: `locale` is passed through exactly as given, and a host that says
 * nothing gets whatever its own resolver defaults to — this package never
 * invents a tag.
 *
 * Generic in `T` so a host with extra sentences of its own keeps their types
 * through the call.
 */
export function messagesOf<T extends AppShellServerMessages>(
  config: { messages: AppShellCopySource<T> },
  locale?: string,
): T {
  return resolveAppShellCopy(config.messages, locale);
}

/** An error a descriptor answers with directly, status and all. */
export class AppShellApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppShellApiError';
  }
}

/** `{ data }`, the envelope every `createApi*` surface in this org answers with. */
export function ok(data: unknown): AppShellResponse {
  return { status: 200, body: { data } };
}

/** No body at all — not `null`, which a client would parse as a value. */
export function noContent(cookies?: readonly AppShellCookie[]): AppShellResponse {
  return cookies && cookies.length > 0
    ? { status: 204, body: undefined, cookies }
    : { status: 204, body: undefined };
}

/**
 * Turn a thrown error into a response.
 *
 * An {@link AppShellApiError} carries its own status. Anything else is a 500 with
 * the host's message and the error RE-THROWN nowhere — it is reported as a status,
 * never swallowed into a success.
 *
 * `report` is the unexpected branch's only trace. It is called BEFORE the fold and
 * only on that branch, so a chosen status stays a status and an incident stays an
 * incident. Its own failure is swallowed on purpose: a reporter is diagnostics, and
 * diagnostics may not decide what the caller receives — the 500 goes out either way.
 */
export function foldApiError(
  error: unknown,
  messages: AppShellServerMessages,
  report?: (error: unknown) => void,
): AppShellResponse {
  if (error instanceof AppShellApiError) {
    return { status: error.status, body: { error: error.message } };
  }
  if (report) {
    try {
      report(error);
    } catch {
      // See above: the response is not the reporter's to break.
    }
  }
  return { status: 500, body: { error: messages.recordFailed } };
}
