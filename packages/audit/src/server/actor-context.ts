/**
 * Per-request "who is acting" context (12-14), backed by Node's
 * AsyncLocalStorage. The host stamps the authorized actor once; the audit writer
 * and the `created_by`/`updated_by` Prisma extension read it, so no repository
 * signature or call site has to thread an actor through by hand.
 *
 * The context carries THREE things, and the third is the one that needs care:
 *
 *  1. `userId` — the id this request is acting under. LAST-WRITE-WINS by design
 *     (it also feeds `created_by`/`updated_by`, a mutable and therefore
 *     correctable question).
 *  2. `role` / `scope` — the authority the request was authorized under.
 *  3. the impersonation PAIR — the subject a session is being rendered as, plus
 *     the real human behind it. See {@link ActorAttributionSnapshot.realUserId}
 *     for why the real human cannot simply be read back out of `userId`.
 *
 * Server-only: AsyncLocalStorage is a Node API. Never import it from an Edge
 * runtime.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** Role/scope/impersonation attribution a caller may STAMP. */
export interface ActorAttribution {
  /** The role name the request was authorized under (e.g. `ADMIN`), if known. */
  role?: string;
  /** The scope the authorization decision was made in (tenant id / `GLOBAL`). */
  scope?: string;
  /**
   * The user id this request is being rendered AS — an impersonation target, or
   * a previewed member.
   *
   * NEVER the actor: {@link ActorContext.userId} stays the real human whose
   * credentials authorized the request, and this is recorded ALONGSIDE it. The
   * audit trail must answer "who really did this" and "who did the screen claim
   * to be" independently, and a single field cannot.
   *
   * `undefined` leaves an existing value untouched (see {@link setActor}'s merge
   * rule); pass `null` to CLEAR it explicitly. Merge semantics make the
   * distinction load-bearing: an impersonation that cannot be cleared would leak
   * onto every later write in the same request.
   */
  onBehalfOfUserId?: string | null;
}

/**
 * What {@link getActorAttribution} hands back: everything a caller may stamp,
 * plus the one field only this module ever writes.
 */
export interface ActorAttributionSnapshot extends ActorAttribution {
  /**
   * The REAL human behind a live impersonation — captured from the same stamp
   * that declared it, and absent/`null` when no impersonation is live.
   * Deliberately NOT part of {@link ActorAttribution}: a caller cannot pass it,
   * only this module derives it (and {@link setActor} ignores it if a
   * JavaScript caller tries, which is what makes the pair unspoofable from
   * request input).
   *
   * Why it exists rather than "just read `userId`": that field is
   * last-write-wins, and in the host this came from about sixty route bodies
   * call `setActor(grant.userId, …)` themselves instead of going through the
   * impersonation-aware stamp. While a session is impersonated the tenant guard
   * resolves that grant for the EFFECTIVE subject, so those calls re-stamp
   * `userId` with the person being impersonated — and an audit row derived from
   * it then reads as though the impersonated person did the thing themselves.
   * The table is append-only, so nothing can put that right afterwards.
   *
   * Editing sixty call sites would fix one tree and rot at the sixty-first, so
   * the invariant lives HERE: the real human is recorded ONCE, by the stamp that
   * knows both halves, and an unaware `setActor(someId)` has no way to reach it
   * — it moves only when the impersonation is re-declared or cleared.
   */
  realUserId?: string | null;
}

export interface ActorContext extends ActorAttributionSnapshot {
  /** The acting user's id, stamped onto created_by/updated_by. */
  userId: string;
}

// Kept on globalThis so a dev server that re-evaluates this module (hot reload)
// cannot create a second store whose context is invisible to closures captured
// against the first.
//
// THE KEY IS A CROSS-PACKAGE CONTRACT, not a private detail, and that is why it
// keeps a host-flavoured name in a generic package. `@12-apps/prisma` ships the
// copy of this module that this one was ported from, keyed to
// `__futurePayActorStore`, and re-exports `setActor`/`getActorUserId`/
// `runWithActor` bound to it. A host adopting this package keeps those ~60
// existing `setActor(...)` call sites and routes its WRITES through `write()`
// (ADOPTING.md rule 3) — so a different key here means the writer reads a store
// nothing ever stamped: every row lands actor_user_id/actor_role/scope/
// on_behalf_of_user_id NULL, the viewer says "Sistema" for every human action,
// and the table is append-only, so the attribution is gone for good. Nothing
// fails on the way: the rows are structurally valid and each package's own
// suites stamp through their own store.
//
// The two context shapes are structurally identical, so sharing the instance is
// safe (a `realUserId` forged through the older copy's spread is inert in this
// package's writer, which requires BOTH halves of the pair). The prettier
// `__12appsActorStore` would have to change `@12-apps/prisma` too, and that is
// the de-duplication PR — one module in one package — that this key is holding
// the door open for. Interop is pinned by
// `packages/prisma/tests/actor-context-audit-interop.test.ts`, the only test
// that imports both copies.
const globalStore = globalThis as unknown as {
  __futurePayActorStore?: AsyncLocalStorage<ActorContext>;
};

const store = (): AsyncLocalStorage<ActorContext> =>
  (globalStore.__futurePayActorStore ??= new AsyncLocalStorage<ActorContext>());

/**
 * The REAL human behind `onBehalfOfUserId`, DERIVED (never accepted) from the
 * stamp that declares the impersonation.
 *
 * `userId` is that human by construction: the only stamp that may pass a
 * non-null `onBehalfOfUserId` is the one that knows the real id and the subject
 * in the SAME call. That co-location is the whole reason the pair can be
 * trusted — nothing else knows both halves at once, so nothing else can forge
 * one.
 *
 * Clearing is symmetric: ending an impersonation drops BOTH halves. A stale real
 * id left behind would make every later write in the request look as though it
 * still carried a hidden second identity.
 */
const realActorFor = (userId: string, onBehalfOfUserId: string | null): string | null =>
  onBehalfOfUserId === null ? null : userId;

/**
 * A fresh context for `userId`.
 *
 * Fields are copied ONE BY ONE rather than spread: the attribution object comes
 * from host code, and an object literal reaching this function with a
 * `realUserId` key of its own must not become the answer to "who is answerable
 * for this append-only row". The impersonation pair is derived only when the
 * stamp expressed an opinion — `undefined` means "no opinion" everywhere in this
 * module, and must never be written as a value.
 */
const freshContext = (userId: string, attribution: ActorAttribution): ActorContext => ({
  userId,
  ...(attribution.role !== undefined ? { role: attribution.role } : {}),
  ...(attribution.scope !== undefined ? { scope: attribution.scope } : {}),
  ...(attribution.onBehalfOfUserId !== undefined
    ? {
        onBehalfOfUserId: attribution.onBehalfOfUserId,
        realUserId: realActorFor(userId, attribution.onBehalfOfUserId),
      }
    : {}),
});

/** Run `fn` with `userId` as the current actor. Nested calls override. */
export const runWithActor = <T>(
  userId: string,
  fn: () => T,
  attribution: ActorAttribution = {},
): T => store().run(freshContext(userId, attribution), fn);

/**
 * Establish an EMPTY actor scope for one request and run `fn` inside it — the
 * request-boundary bootstrap (the Hono adapter wraps every request in it).
 *
 * Why it must exist: {@link setActor} inside an AWAITED guard would otherwise
 * use `enterWith`, which only applies to the guard's own async continuation —
 * the CALLER resumes with the context it captured before the call, so the stamp
 * silently vanishes and every audit entry reads "system". With a scope
 * established here, `setActor` MUTATES the shared context object instead, which
 * every frame of the request's async tree observes, so stamps from arbitrarily
 * deep guards survive back into the handler and its repositories.
 *
 * That mutation is scoped to ONE request: `store().run` gives each call its own
 * context object, and concurrent requests never see each other's (proven by the
 * interleaving cases in `__tests__/actor-context.test.ts`).
 */
export const runWithActorScope = <T>(fn: () => T): T => store().run({ userId: '' }, fn);

/**
 * Stamp the current actor for the rest of this request. A falsy id is ignored so
 * nothing is ever stamped with an empty string. Attribution fields MERGE — only
 * the fields passed are updated — so a guard that knows just the scope does not
 * erase a role a caller stamped (or vice versa). Inside a
 * {@link runWithActorScope} boundary the stamp mutates the shared context (and
 * so survives the caller's awaits); without one it falls back to `enterWith`,
 * which reaches the current async branch only.
 */
export const setActor = (userId: string, attribution: ActorAttribution = {}): void => {
  if (!userId) return;
  const current = store().getStore();
  if (!current) {
    store().enterWith(freshContext(userId, attribution));
    return;
  }
  current.userId = userId;
  if (attribution.role !== undefined) current.role = attribution.role;
  if (attribution.scope !== undefined) current.scope = attribution.scope;
  // Same merge rule, and the reason it must be `!== undefined` rather than a
  // truthiness check: ENDING an impersonation is expressed as `null`, and a
  // truthy guard would read that clear as "no opinion" and leave the previous
  // target standing for the rest of the request.
  //
  // Note what this branch does NOT do: an unaware stamp — one that passes no
  // `onBehalfOfUserId` at all — moves `userId` and nothing else. The pair
  // survives it untouched, which is the property the audit trail is built on.
  if (attribution.onBehalfOfUserId !== undefined) {
    current.onBehalfOfUserId = attribution.onBehalfOfUserId;
    current.realUserId = realActorFor(userId, attribution.onBehalfOfUserId);
  }
};

/** The current actor's user id, or `undefined` when no actor is set. */
export const getActorUserId = (): string | undefined => store().getStore()?.userId || undefined;

/**
 * The current actor's role/scope attribution plus the impersonation PAIR — the
 * subject the request is rendered as, and the real human behind it — if stamped.
 * Every field is `undefined` when nothing stamped it: the writer normalizes that
 * to NULL at the row, so the distinction between "never stamped" and "explicitly
 * cleared" stays here, where {@link setActor}'s merge rule needs it, and never
 * leaks into a column.
 *
 * Both halves of the pair are returned together and must be read together:
 * `onBehalfOfUserId` alone says an impersonation was *declared*, `realUserId`
 * says who is answerable for it. A consumer seeing one without the other is
 * looking at a context nothing in production can produce, and should treat the
 * session as NOT impersonated rather than guess.
 */
export const getActorAttribution = (): ActorAttributionSnapshot => {
  const context = store().getStore();
  return {
    role: context?.role,
    scope: context?.scope,
    onBehalfOfUserId: context?.onBehalfOfUserId,
    realUserId: context?.realUserId,
  };
};
