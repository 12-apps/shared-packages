/**
 * The one thing this package exposes to a BACKEND host (12-14).
 *
 * What used to be stranded in future-pay: the writer, the role-audit helper, the
 * retention sweep and the listing route in `apps/web/lib/audit` + one route file
 * (612 LOC), plus three modules inside its private Prisma package — the
 * AsyncLocalStorage actor context (218), the `created_by`/`updated_by` stamping
 * extension (121, with five restaurant model names hard-coded in it) and the
 * append-only guard (75). None of that was ever future-pay's business except the
 * answers to "who is calling" and "where does the data live".
 *
 * Routes are FRAMEWORK-NEUTRAL descriptors, not a Hono/Express router — the
 * report-builder doctrine. `@12-apps/audit/hono` adapts them in forty lines.
 *
 * What stays the HOST's, and is passed in rather than guessed at:
 *
 *  - **Authentication and tenant resolution** — `resolveActor` hands over the
 *    tenant id, the user id, the caller's permission ids and, when a session is
 *    impersonating, the subject it is rendering as.
 *  - **Identity** — name/e-mail for a user id, through the directory port.
 *  - **The vocabulary** — which actions and resources exist, and which fields a
 *    diff may carry.
 *  - **Where the data lives** — the one owned model through the db seam.
 *  - **Entitlements and quota** — billing questions, answered in `resolveActor`
 *    (or by the host's own gate) before a request reaches a descriptor; and the
 *    retention WINDOW, which is why the sweep takes a range instead of a plan.
 */
import { indexVocabulary, type AuditVocabularyIndex } from '../core/vocabulary';

import { applyAppendOnlyGuard } from './append-only-extension';
import { applyAuditStamps } from './audit-extension';
import { runWithActorScope, setActor } from './actor-context';
import type { AuditRequest, AuditRoute, AuditServerConfig } from './config';
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
  /** The indexed vocabulary — labels and validation, shared with the wire. */
  vocabulary: AuditVocabularyIndex;
}

export function createApiAudit(config: AuditServerConfig): ApiAudit {
  const index = indexVocabulary(config.vocabulary);
  const store = createAuditStore(config.db, config.directory);
  const write = createAuditWriter(index);
  const retention = createAuditRetention(config.db, config.retention);
  const trackedModels = config.trackedModels ?? [];
  const appendOnlyModels = config.appendOnlyModels ?? ['AuditLog'];

  const auditStamps = <T,>(client: T): T => applyAuditStamps(client, { trackedModels });
  const appendOnly = <T,>(client: T): T =>
    applyAppendOnlyGuard(client, { models: appendOnlyModels });

  return {
    routes: auditRoutes({ config, index, store }),
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
    vocabulary: index,
  };
}
