/**
 * The one thing this package exposes to a BACKEND host.
 *
 * Routes are FRAMEWORK-NEUTRAL descriptors, not a Hono/Express router;
 * `@12-apps/audit/hono` adapts them in forty lines.
 *
 * What stays the HOST's, and is passed in rather than guessed at:
 *
 *  - **Authentication and tenant resolution** — `resolveActor` hands over the
 *    tenant id, the user id, the caller's permission ids and, when a session is
 *    impersonating, the subject it is rendering as.
 *  - **Identity** — name/e-mail for a user id, through the directory port.
 *  - **The vocabulary** — which actions and resources exist, what they are
 *    called, and which fields a diff may carry. There is no default: a
 *    package-supplied vocabulary is one application's, and a host that inherited
 *    it would have every diff field its own writers emit dropped by an allowlist
 *    written for somebody else's columns.
 *  - **The user-facing copy, the gate permission ids and the paging numbers** —
 *    defaults exist for all three, and all three are the package's own rather
 *    than one market's.
 *  - **Where the data lives** — the one owned model through the db seam.
 *  - **Entitlements and quota** — billing questions, answered in `resolveActor`
 *    (or by the host's own gate) before a request reaches a descriptor; and the
 *    retention WINDOW, which is why the sweep takes a range instead of a plan.
 *
 * ASSEMBLY IS WHERE THIS SURFACE REFUSES. Every guard the config has runs here,
 * at boot, before a single route exists — a vocabulary that was not built by
 * `defineAuditVocabulary`, a blank message or gate id, a page size that bounds
 * nothing, a retention floor that would sweep the whole trail, a model name with
 * a trailing space. A host that starts the process has met all of them.
 */
import { assertAuditVocabulary, type AuditVocabulary } from '../core/vocabulary';

import { applyAppendOnlyGuard, AUDIT_LOG_MODEL } from './append-only-extension';
import { applyAuditStamps } from './audit-extension';
import { runWithActorScope, setActor } from './actor-context';
import type { AuditRequest, AuditRoute, AuditServerConfig } from './config';
import { gatesOf, messagesOf, modelNamesOf, pagingOf } from './policy';
import { auditRoutes } from './routes';
import { createAuditRetention, type AuditRetention } from './retention';
import { createAuditStore, type AuditStore } from './store';
import type { AuditWriter } from './writer';
import { createAuditWriter } from './writer';

export interface ApiAudit {
  /** The whole read surface, in mount order. */
  routes: AuditRoute[];
  /**
   * The transactional writer: `write(tx, entry)`, called INSIDE the caller's
   * transaction so the entry and the mutation commit or roll back together.
   */
  write: AuditWriter;
  /**
   * Wrap the host's Prisma client so tracked-model writes carry
   * `created_by`/`updated_by` and the append-only models refuse mutation. Both
   * extensions in the order a host wants them; call it once, at client
   * construction.
   */
  extendPrismaClient<T>(client: T): T;
  /** The two extensions separately, for a host composing its own client. */
  extensions: {
    auditStamps<T>(client: T): T;
    appendOnly<T>(client: T): T;
  };
  /**
   * The per-request actor-context middleware.
   *
   * `withActorContext(request, run)` opens ONE AsyncLocalStorage scope for the
   * request, stamps the actor the host resolved (including the impersonation
   * pair) and runs the handler inside it. Two properties matter, and both are
   * tested: a stamp made inside an AWAITED guard survives back into the handler
   * (that is why the scope is opened here rather than left to `setActor`), and
   * concurrent requests never observe each other's actor.
   */
  withActorContext<T>(request: AuditRequest, run: () => Promise<T>): Promise<T>;
  retention: AuditRetention;
  /** The read store, for a host surface that reads the same rows (an MCP tool…). */
  store: AuditStore;
  /** The vocabulary in force — the guarded value the host declared. */
  vocabulary: AuditVocabulary;
}

export function createApiAudit(config: AuditServerConfig): ApiAudit {
  // Every refusal, before anything is built. `assertAuditVocabulary` first,
  // because a vocabulary that never went through `defineAuditVocabulary` is the
  // one failure that would otherwise be discovered by a hollow row.
  const vocabulary = assertAuditVocabulary(config.vocabulary);
  const messages = messagesOf(config);
  const gates = gatesOf(config);
  const paging = pagingOf(config);
  const trackedModels = modelNamesOf('trackedModels', config.trackedModels);
  const hostAppendOnly = modelNamesOf('appendOnlyModels', config.appendOnlyModels);

  const store = createAuditStore(config.db, config.directory);
  const write = createAuditWriter(vocabulary);
  const retention = createAuditRetention(config.db, config.retention);

  // This package's own model is ALWAYS guarded, and a host's names ADD to it.
  // It used to be the DEFAULT value of `appendOnlyModels`, which meant the
  // obvious way to guard a second table — `appendOnlyModels: ['MyLedger']` —
  // silently switched the audit log's own immutability off, and `[]` switched
  // the guard off entirely while reading like the default written out.
  const appendOnlyModels = [AUDIT_LOG_MODEL, ...hostAppendOnly];

  const auditStamps = <T,>(client: T): T => applyAuditStamps(client, { trackedModels });
  const appendOnly = <T,>(client: T): T =>
    applyAppendOnlyGuard(client, { models: appendOnlyModels });

  return {
    routes: auditRoutes({ config, vocabulary, store, messages, gates, paging }),
    write,
    extendPrismaClient: <T,>(client: T): T => appendOnly(auditStamps(client)),
    extensions: { auditStamps, appendOnly },
    async withActorContext<T>(request: AuditRequest, run: () => Promise<T>): Promise<T> {
      return runWithActorScope(async () => {
        const actor = await config.resolveActor(request);
        // A caller with no user row (a platform operator authorized by an
        // allowlist) stamps nothing: `setActor` ignores a falsy id, so the
        // context stays empty and the writer records a system entry rather than
        // inventing an actor. The impersonation pair only travels with a real id,
        // which is the same reason — a subject with nobody answerable for it is
        // not an attribution.
        if (actor?.userId) {
          setActor(actor.userId, {
            ...(actor.role != null ? { role: actor.role } : {}),
            ...(actor.scope != null ? { scope: actor.scope } : {}),
            ...(actor.onBehalfOfUserId !== undefined
              ? { onBehalfOfUserId: actor.onBehalfOfUserId }
              : {}),
          });
        }
        return run();
      });
    },
    retention,
    store,
    vocabulary,
  };
}
