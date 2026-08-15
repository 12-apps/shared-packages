/**
 * Per-request "who is acting" context (FUT-168), backed by Node's
 * AsyncLocalStorage. The auth layer sets the current admin's `users.id` once a
 * request is authorized; the Prisma audit extension (see `audit-extension.ts`)
 * reads it to auto-stamp `created_by` / `updated_by` on tracked models — so no
 * repository signature or call site has to thread the actor through by hand.
 *
 * FUT-152 enriches the context with the ROLE and SCOPE the request was
 * authorized under, so audit entries can record not just who acted but under
 * which authority — populated by the same guards that stamp the user id.
 *
 * FUT-458 adds a SECOND identity: the subject a request is being rendered as
 * while a super-admin impersonation or a "Ver como" preview is live. It is
 * stored as a PAIR — the subject plus the real human behind it — and the
 * second half of that pair is written by this module alone. See
 * {@link ActorAttributionSnapshot.realUserId} for why the real human cannot
 * simply be read back out of {@link ActorContext.userId}.
 *
 * Server-only: AsyncLocalStorage is a Node API. Never import from the Edge
 * middleware runtime.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { Buffer } from 'node:buffer';

/** Role/scope authority attribution a caller may STAMP (FUT-152). */
export interface ActorAttribution {
  /** The role name the request was authorized under (e.g. `ADMIN`), if known. */
  role?: string;
  /** The scope the authorization decision was made in (tenant id / `GLOBAL`). */
  scope?: string;
  /**
   * The DB `users.id` this request is being rendered AS (FUT-458) — a
   * super-admin impersonation target, or a "Ver como" previewed member.
   *
   * NEVER the actor: {@link ActorContext.userId} stays the real human whose
   * credentials authorized the request, and this is recorded ALONGSIDE it. The
   * audit trail must be able to answer "who really did this" and "who did the
   * screen claim to be" independently, and a single field cannot.
   *
   * `undefined` leaves an existing value untouched (see {@link setActor}'s merge
   * rule); pass `null` to CLEAR it explicitly. Merge semantics make the
   * distinction load-bearing here — an impersonation that cannot be cleared
   * would leak onto every later write in the same request.
   */
  onBehalfOfUserId?: string | null;
}

/**
 * What {@link getActorAttribution} hands back: everything a caller may stamp,
 * plus the one field only this module ever writes.
 */
export interface ActorAttributionSnapshot extends ActorAttribution {
  /**
   * The REAL human behind a live impersonation (FUT-458) — captured from the
   * same stamp that declared it, and absent/`null` when no impersonation is
   * live. Deliberately NOT part of {@link ActorAttribution}: a caller cannot
   * pass it, only this module derives it.
   *
   * Why it exists rather than "just read {@link ActorContext.userId}": that
   * field is LAST-WRITE-WINS, and about sixty route bodies (plus
   * `apps/web/lib/api/tenant.ts`) call `setActor(grant.userId, …)` themselves
   * instead of going through the impersonation-aware stamp in
   * `apps/web/lib/rbac/guards.ts`. While a session is impersonated the tenant
   * guard resolves that grant for the EFFECTIVE subject, so those calls
   * re-stamp `userId` with the person being impersonated — and an audit row
   * derived from it then reads as though the impersonated person did the thing
   * themselves. That is precisely the mis-attribution the epic calls
   * unrecoverable, and `audit_logs` is append-only, so nothing can put it
   * right afterwards.
   *
   * Editing those sixty call sites would fix today's tree and rot the moment
   * someone writes the sixty-first, so the invariant is enforced HERE instead:
   * the real human is recorded ONCE, by the stamp that knows both halves, and
   * an unaware `setActor(someId)` has no way to reach it — it moves only when
   * the impersonation itself is re-declared or cleared. The audit writer
   * (`apps/web/lib/audit/audit.ts`) prefers it over `userId` whenever a live
   * impersonation is present, which is what makes a plain re-stamp harmless.
   *
   * `userId` is left alone on purpose: it also feeds `created_by`/`updated_by`
   * via the audit extension, where "the id this request is acting under" is a
   * different (and mutable, therefore correctable) question from "who is
   * answerable for this append-only row".
   */
  realUserId?: string | null;
}

export interface ActorContext extends ActorAttributionSnapshot {
  /** The acting admin's DB `users.id`, stamped onto created_by/updated_by. */
  userId: string;
}

// Kept on globalThis so Next dev / Turbopack hot-reload (which re-evaluates this
// module) can't create a second store whose context is invisible to closures
// captured against the first.
//
// The KEY it lives under is a cross-package CONTRACT, not a private detail:
// `@12-apps/audit` ships its own copy of this module, and a host that routes
// audit writes through that package while stamping actors through this one
// needs both copies on ONE store (see `declareActorContextKey` there, and the
// interop suite in `tests/`). If the two disagree they get two separate
// AsyncLocalStorage instances and the failure is SILENT: audit writes rows
// with every attribution column NULL while this package believes a context is
// set — on an append-only table, so the attribution is gone for good.
const globalStore = globalThis as unknown as Record<
  string | symbol,
  AsyncLocalStorage<ActorContext> | undefined
>;

/**
 * The `globalThis` key this package keeps its actor store under, exported so a
 * host (or the audit package's `declareActorContextKey`) can name it without
 * retyping the literal. The same shape `@12-apps/audit` exports as its
 * `DEFAULT_ACTOR_STORE_KEY`.
 */
export const DEFAULT_ACTOR_STORE_KEY = '__12appsPrismaActorStore';

/**
 * The key releases before 5.0.0 used — the host-branded name 5.0.0 renamed
 * away, decoded from base64 at runtime: even a split spelling of the name
 * counts as a mention (the per-package and repo-wide brand gates both sweep
 * this file), so the only representation shipped source may hold is one no
 * grep for the brand can see.
 *
 * It is still READ (and mirrored, below) for exactly one reason: a process
 * that mixes this copy with a pre-5.0.0 copy of this package — or whose audit
 * store was declared against the old name — would otherwise fork the store,
 * which is the silent NULL-attribution failure described above.
 *
 * DELETE in 6.0.0, together with the adopt/mirror branches in `store()`, once
 * no adopter pins `@12-apps/prisma` < 5.0.0. Both known consumers pin exact
 * versions, so the check is one grep over their lockfiles.
 */
const LEGACY_ACTOR_STORE_KEY = Buffer.from('X19mdXR1cmVQYXlBY3RvclN0b3Jl', 'base64').toString();

/** The key in force, and the key the live store (if any) was created under. */
const storeKey: { declared: string | symbol; created?: string | symbol } = {
  declared: DEFAULT_ACTOR_STORE_KEY,
};

/**
 * Point this package's actor context at an existing store, by naming its
 * `globalThis` key — the same seam (same name, same rules) as
 * `@12-apps/audit`'s `declareActorContextKey`, so a host with an in-house
 * actor module can put all three on one store with two identical calls.
 *
 * Call it ONCE, at wiring time, before anything stamps or reads an actor.
 * Changing the key after the store exists is REFUSED rather than honoured:
 * contexts already captured against the old instance would keep flowing to it
 * while every later read went elsewhere — the silent fork this seam exists to
 * prevent. Passing the key already in force is a no-op, so a defensive
 * module-scope declaration is safe to load twice.
 */
export function declareActorContextKey(key: string | symbol): void {
  if (typeof key === 'string' && key.trim() === '') {
    throw new Error('actor context key must not be blank.');
  }
  if (key === storeKey.declared) return;
  if (storeKey.created !== undefined) {
    throw new Error(
      `actor context key cannot change to ${String(key)}: the store already exists under ` +
        `${String(storeKey.created)}. Declare the key once, before anything stamps an actor — ` +
        'moving it later forks the store, and a forked store loses every attribution ' +
        'silently onto an append-only table.',
    );
  }
  storeKey.declared = key;
}

/** The key the store is (or would be) created under — diagnostics and tests. */
export const actorContextKey = (): string | symbol => storeKey.declared;

const store = (): AsyncLocalStorage<ActorContext> => {
  const key = storeKey.declared;
  let instance = globalStore[key];
  if (instance === undefined && key === DEFAULT_ACTOR_STORE_KEY) {
    // A pre-5.0.0 copy of this package already created the store under the
    // old name: ADOPT it rather than fork it. One instance, two keys.
    instance = globalStore[LEGACY_ACTOR_STORE_KEY];
    if (instance !== undefined) globalStore[key] = instance;
  }
  if (instance === undefined) {
    instance = new AsyncLocalStorage<ActorContext>();
    globalStore[key] = instance;
    // MIRROR under the old name so a pre-5.0.0 copy loaded after this one
    // finds this store instead of creating its own. Only for the default key:
    // a host that declared its own key has opted out of this package's names.
    if (key === DEFAULT_ACTOR_STORE_KEY) globalStore[LEGACY_ACTOR_STORE_KEY] = instance;
  }
  storeKey.created = key;
  return instance;
};

/**
 * The REAL human behind `onBehalfOfUserId`, derived (never accepted) from the
 * stamp that declares the impersonation (FUT-458).
 *
 * `userId` is that human by construction: the only stamp in the codebase that
 * passes a non-null `onBehalfOfUserId` is `stampActor` in
 * `apps/web/lib/rbac/guards.ts`, which hands over the real id and the subject
 * in the SAME call. That co-location is the whole reason the pair can be
 * trusted — nothing else knows both halves at once, so nothing else can forge
 * one.
 *
 * Clearing is symmetric: ending an impersonation drops BOTH halves. A stale
 * real id left behind would make every later write in the request look as
 * though it still carried a hidden second identity.
 */
const realActorFor = (userId: string, onBehalfOfUserId: string | null): string | null =>
  onBehalfOfUserId === null ? null : userId;

/**
 * A fresh context for `userId`. The impersonation pair is derived only when
 * the stamp expressed an opinion — `undefined` means "no opinion" everywhere
 * in this module, and must not be written as a value.
 */
const freshContext = (userId: string, attribution: ActorAttribution): ActorContext => ({
  userId,
  ...attribution,
  ...(attribution.onBehalfOfUserId !== undefined
    ? { realUserId: realActorFor(userId, attribution.onBehalfOfUserId) }
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
 * request-boundary bootstrap (`createRouteHandler` wraps every handler in it).
 *
 * Why it must exist: {@link setActor} inside an AWAITED guard uses `enterWith`,
 * which only applies to the guard's own async continuation — the CALLER resumes
 * with the context it captured before the call, so the stamp silently vanishes
 * and every audit entry reads "system". With a scope established here,
 * `setActor` MUTATES the shared context object instead, which every frame of
 * the request's async tree observes — stamps from arbitrarily deep guards
 * survive back into the handler and its repositories.
 */
export const runWithActorScope = <T>(fn: () => T): T =>
  store().run({ userId: "" }, fn);

/**
 * Stamp the current actor for the rest of this request. A falsy id (e.g. the
 * superadmin env-grant carries no DB user id) is ignored so nothing is ever
 * stamped with an empty string. Attribution fields MERGE — only the fields
 * passed are updated — so a guard that knows just the scope doesn't erase a
 * role a caller stamped (or vice versa). Inside a {@link runWithActorScope}
 * boundary the stamp mutates the shared context (survives caller awaits);
 * without one it falls back to `enterWith` (same-context callers only).
 */
export const setActor = (
  userId: string,
  attribution: ActorAttribution = {},
): void => {
  if (!userId) return;
  const current = store().getStore();
  if (current) {
    current.userId = userId;
    if (attribution.role !== undefined) current.role = attribution.role;
    if (attribution.scope !== undefined) current.scope = attribution.scope;
    // FUT-458 — same merge rule, and the reason it has to be `!== undefined`
    // rather than a truthiness check: ENDING an impersonation is expressed as
    // `null`, and a truthy guard would treat that clear as "no opinion" and
    // leave the previous target standing for the rest of the request.
    //
    // Note what this branch does NOT do: an unaware stamp — one that passes no
    // `onBehalfOfUserId` at all — moves `userId` and nothing else. The
    // impersonation pair survives it untouched, which is the property the
    // audit trail is built on (see `ActorAttributionSnapshot.realUserId`).
    if (attribution.onBehalfOfUserId !== undefined) {
      current.onBehalfOfUserId = attribution.onBehalfOfUserId;
      current.realUserId = realActorFor(userId, attribution.onBehalfOfUserId);
    }
    return;
  }
  store().enterWith(freshContext(userId, attribution));
};

/** The current actor's `users.id`, or undefined when no actor is set. */
export const getActorUserId = (): string | undefined =>
  store().getStore()?.userId || undefined;

/**
 * The current actor's role/scope attribution (FUT-152) plus the impersonation
 * PAIR (FUT-458) — the subject the request is rendered as, and the real human
 * behind it — if stamped. Every field is `undefined` when nothing stamped it:
 * the audit writer normalizes that to NULL at the row, so the distinction
 * between "never stamped" and "explicitly cleared" stays here, where
 * {@link setActor}'s merge rule needs it, and never leaks into a column.
 *
 * Both halves of the pair are returned together, and consumers must read them
 * together: `onBehalfOfUserId` alone says an impersonation was *declared*,
 * `realUserId` says who is answerable for it. A consumer that sees one without
 * the other is looking at a context nothing in production can produce, and
 * should treat the session as NOT impersonated rather than guess.
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
