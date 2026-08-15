/**
 * The one thing this package exposes to a BACKEND host (12-17).
 *
 * The endpoints used to live in the host: six hand-written route files PER
 * COLLECTION (54 files across the eight collections with per-entity routes,
 * ~1.8k LOC of registrations beside them), each parsing a request, building a
 * context, calling the lifecycle service
 * and shaping a response. Only "who is calling, on which tenant, with which
 * feature layers" was ever the host's business; the rest is this surface's
 * contract, and the frontend half (`createWebEntityLifecycle`) lives here
 * too, so the two can never drift.
 *
 * Routes are FRAMEWORK-NEUTRAL descriptors, not a Hono/Express router — the
 * report-builder doctrine. `@12-apps/entity-lifecycle/hono` adapts them.
 *
 * What stays the HOST's, and is passed in rather than guessed at:
 *
 *  - **Authentication, tenant resolution and RBAC** — the host hands over a
 *    {@link LifecycleActor} (tenant id, user id, permission ids, the tenant's
 *    two feature layers).
 *  - **Entitlements/billing** — the plan gate on a collection's whole surface
 *    (the origin host's `requireEntitlement(tenant, 'suppliers')`) is the host's
 *    answer, supplied per collection as `registration.authorize` and awaited
 *    here. It cannot be a wrapper around the mount: the recycle-bin and
 *    approvals item routes carry no collection prefix, so which collection is
 *    being restored, purged or decided is known only after reading the row.
 *  - **Entity writes** — each registration's {@link EntityOps} owns the host
 *    tables; the package owns everything recorded ABOUT them.
 *  - **Where the four owned tables live** — the structural db seam.
 */

import { createEntityLifecycle, type EntityLifecycle } from '../service';
import type { LifecycleContext, LifecycleStores } from '../types';

import {
  contextOf,
  messagesOf,
  type LifecycleActor,
  type LifecycleMessages,
  type LifecycleRoute,
  type LifecycleUserDirectory,
} from './context';
import type { LifecycleDbProvider } from './db';
import { entityRoutes } from './routes-entity';
import { sharedRoutes, type RegisteredEntity } from './routes-shared';
import type { LifecycleEntityRegistration } from './registration';
import { createDbLifecycleStores } from './stores';

export interface EntityLifecycleServerConfig {
  /** Prisma-shaped client for the four owned models, through the seam. */
  db: LifecycleDbProvider;
  /** One declaration per plugged-in collection. */
  entities: readonly LifecycleEntityRegistration[];
  /** The host's user directory (actor names on history/bin/approvals). */
  directory?: LifecycleUserDirectory;
  /** User-facing copy overrides. */
  messages?: Partial<LifecycleMessages>;
}

/** A registered collection's service + per-request context builder. */
export interface EntityLifecycleHandle {
  registration: LifecycleEntityRegistration;
  /** The core service — what the host's OWN entity routes call for writes. */
  lifecycle: EntityLifecycle;
  /** The per-request context for this collection, from the resolved actor. */
  context(actor: LifecycleActor): LifecycleContext;
}

export interface ApiEntityLifecycle {
  /** The whole generated surface, in mount order. */
  routes: LifecycleRoute[];
  /** The shared storage adapters, for host surfaces that read the same tables. */
  stores: LifecycleStores;
  /**
   * The handle the host's own entity routes use: `entity('product').lifecycle`
   * funnels a create/update/delete through versioning + bin + approvals with
   * the same context the generated endpoints build. Throws on an unknown type.
   */
  entity(entityType: string): EntityLifecycleHandle;
}

const RESERVED_SLUGS = new Set(['recycle-bin', 'approvals']);

export function createApiEntityLifecycle(
  config: EntityLifecycleServerConfig,
): ApiEntityLifecycle {
  const messages = messagesOf(config);
  const stores = createDbLifecycleStores(config.db);

  const entities = new Map<string, RegisteredEntity>();
  const slugs = new Set<string>();
  for (const registration of config.entities) {
    if (entities.has(registration.entityType)) {
      throw new Error(`Duplicate entityType registration: ${registration.entityType}`);
    }
    if (slugs.has(registration.slug) || RESERVED_SLUGS.has(registration.slug)) {
      throw new Error(`Duplicate or reserved slug registration: ${registration.slug}`);
    }
    slugs.add(registration.slug);
    entities.set(registration.entityType, {
      registration,
      lifecycle: createEntityLifecycle(
        {
          entityType: registration.entityType,
          features: registration.features,
          ...(registration.featureDefaults !== undefined
            ? { featureDefaults: registration.featureDefaults }
            : {}),
          label: registration.label,
          ...(registration.diff !== undefined ? { diff: registration.diff } : {}),
          ...(registration.retention !== undefined ? { retention: registration.retention } : {}),
        },
        stores,
        registration.ops,
      ),
    });
  }

  const routes: LifecycleRoute[] = [
    ...sharedRoutes({
      entities,
      recycleBin: stores.recycleBin,
      // The stores bundle always carries approvals (createDbLifecycleStores),
      // so the non-null assertion is structural, not hopeful.
      approvals: stores.approvals as NonNullable<LifecycleStores['approvals']>,
      directory: config.directory,
      messages,
    }),
    ...[...entities.values()].flatMap((entity) =>
      entityRoutes({
        registration: entity.registration,
        lifecycle: entity.lifecycle,
        directory: config.directory,
        messages,
      }),
    ),
  ];

  return {
    routes,
    stores,
    entity(entityType) {
      const entry = entities.get(entityType);
      if (!entry) throw new Error(`Unknown lifecycle entityType: ${entityType}`);
      return {
        registration: entry.registration,
        lifecycle: entry.lifecycle,
        context: (actor) => contextOf(actor, entry.registration.approvePermission),
      };
    },
  };
}
