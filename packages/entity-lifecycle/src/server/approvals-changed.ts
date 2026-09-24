/**
 * The queue-change hook behind `onApprovalsChanged` (FUT-2520): a decorator
 * over the approval store that tells the host, after the fact, that a tenant's
 * change-request queue moved.
 *
 * It sits on the STORE rather than on the routes because every write that
 * touches the queue funnels through these three methods — the generated
 * restore and draft-publish routes, the shared approve/reject routes, and the
 * host's own `entity(type).lifecycle` writes alike. One decoration therefore
 * covers them all, and a new route can never forget to call it.
 *
 * Each store call is a standalone write that has committed when it returns,
 * so the callback runs after the commit, never inside it. It is a hint, not a
 * participant: it is not awaited, and neither a throw nor a rejected promise
 * from it can fail the write that triggered it. The host's callback owns its
 * own error reporting.
 */

import type { ApprovalStore } from '../types';

/** The host's callback, as `EntityLifecycleServerConfig` declares it. */
export type ApprovalsChangedListener = (tenantId: string) => void;

/** Call the host's listener, fire-and-forget, never letting it fail a write. */
function notifier(listener: ApprovalsChangedListener): (tenantId: string) => void {
  // Widened to `unknown` so an ASYNC listener (assignable to a `void` return)
  // has its rejection absorbed too, instead of surfacing as unhandled.
  const call: (tenantId: string) => unknown = listener;
  return (tenantId) => {
    try {
      Promise.resolve(call(tenantId)).catch(() => undefined);
    } catch {
      // A synchronous throw is the host's bug, and the write already committed.
    }
  };
}

/**
 * The approval store, reporting every committed change to its queue:
 *
 *  - `create` — a write was parked (a new PENDING request);
 *  - `decide` — only when it returned `true`: a request left PENDING. A lost
 *    compare-and-set race changed nothing, so it reports nothing;
 *  - `reopen` — an approval whose apply failed went back to PENDING.
 *
 * Reads pass straight through.
 */
export function notifyingApprovalStore(
  store: ApprovalStore,
  listener: ApprovalsChangedListener,
): ApprovalStore {
  const notify = notifier(listener);
  return {
    get: (tenantId, requestId) => store.get(tenantId, requestId),
    list: (tenantId, filter) => store.list(tenantId, filter),
    async create(input) {
      const record = await store.create(input);
      notify(input.tenantId);
      return record;
    },
    async decide(tenantId, requestId, decision) {
      const claimed = await store.decide(tenantId, requestId, decision);
      if (claimed) notify(tenantId);
      return claimed;
    },
    async reopen(tenantId, requestId) {
      await store.reopen(tenantId, requestId);
      notify(tenantId);
    },
  };
}
