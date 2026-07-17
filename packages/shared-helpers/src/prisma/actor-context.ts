/**
 * Per-request "who is acting" context (FUT-168), backed by Node's
 * AsyncLocalStorage. The auth layer sets the current admin's `users.id` once a
 * request is authorized; the Prisma audit extension (see `audit-extension.ts`)
 * reads it to auto-stamp `created_by` / `updated_by` on tracked models — so no
 * repository signature or call site has to thread the actor through by hand.
 *
 * Server-only: AsyncLocalStorage is a Node API. Never import from the Edge
 * middleware runtime.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface ActorContext {
  /** The acting admin's DB `users.id`, stamped onto created_by/updated_by. */
  userId: string;
}

// Kept on globalThis so Next dev / Turbopack hot-reload (which re-evaluates this
// module) can't create a second store whose context is invisible to closures
// captured against the first.
const globalStore = globalThis as unknown as {
  __futurePayActorStore?: AsyncLocalStorage<ActorContext>;
};

const store = (): AsyncLocalStorage<ActorContext> =>
  (globalStore.__futurePayActorStore ??= new AsyncLocalStorage<ActorContext>());

/** Run `fn` with `userId` as the current actor. Nested calls override. */
export const runWithActor = <T>(userId: string, fn: () => T): T =>
  store().run({ userId }, fn);

/**
 * Set the current actor for the rest of THIS async context WITHOUT wrapping a
 * callback — the per-request pattern frameworks use. A falsy id (e.g. the
 * superadmin env-grant carries no DB user id) is ignored so nothing is ever
 * stamped with an empty string.
 */
export const setActor = (userId: string): void => {
  if (userId) store().enterWith({ userId });
};

/** The current actor's `users.id`, or undefined when no actor is set. */
export const getActorUserId = (): string | undefined => store().getStore()?.userId;
