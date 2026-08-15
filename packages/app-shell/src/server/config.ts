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
 */

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
 */
export interface AppShellServerMessages {
  /** Body of the 500 when the host's `record` threw. */
  recordFailed: string;
}

export interface AppShellServerConfig {
  /**
   * The terms version this deployment is on. REQUIRED — see the module docstring.
   * Bump it and every previously-consented caller reads `stale: true`.
   */
  termsVersion: string;
  consent: ConsentSeam;
  messages: AppShellServerMessages;
}

export function messagesOf(config: AppShellServerConfig): AppShellServerMessages {
  return config.messages;
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
 */
export function foldApiError(
  error: unknown,
  messages: AppShellServerMessages,
): AppShellResponse {
  if (error instanceof AppShellApiError) {
    return { status: error.status, body: { error: error.message } };
  }
  return { status: 500, body: { error: messages.recordFailed } };
}
