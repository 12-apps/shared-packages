/**
 * Prisma client extension that auto-stamps change attribution (FUT-168).
 *
 * For the tracked models it fills `createdBy` on create and `updatedBy` on
 * create/update from the current actor (see `actor-context.ts`), so repositories
 * and actions never pass an actor id explicitly. A write with no actor in scope
 * (system/seed/unauthenticated) is left untouched — the columns stay NULL.
 *
 * Only fields the caller did not already set are filled, so an explicit override
 * always wins.
 */

import type { PrismaClient } from '@prisma/client';

import { getActorUserId } from './actor-context';
import { normalizeSearchText } from './search-normalize';

/**
 * WHICH models are stamped, and why that is the HOST's to say.
 *
 * This was a hard-coded set of five model names from one application —
 * `MenuItem`, `InventoryItem`, `ProductCategory`, `Supplier`, `Discount` — none
 * of which exist in this package's own schema. `applyAuditStamps` took no
 * config and `getPrismaClient` wrapped EVERY client with it, so the list was not
 * an available default: it was the only behaviour on offer.
 *
 * That fails in both directions at once for anyone else:
 *
 * - **Silently inert.** A host whose models are named anything else gets no
 *   attribution at all. Nothing throws; `created_by` and `updated_by` simply
 *   stay NULL forever, on a trail whose entire purpose is saying who did it.
 * - **Actively broken.** A host that HAS a `Supplier` or `Discount` — hardly
 *   exotic names — but without those columns gets every create/update/upsert on
 *   it rewritten to carry arguments its schema does not have, and Prisma
 *   rejects the call.
 *
 * The `name` → `searchName` denormalisation had the same problem and is now a
 * SEPARATE list, because the two coincided only in that one application. A host
 * can attribute a model without keeping a normalised search column on it, and
 * the reverse.
 */
export interface AuditStampConfig {
  /** Models carrying `createdBy` / `updatedBy`. Empty means stamp nothing. */
  trackedModels: readonly string[];
  /**
   * Models that also keep `searchName` in sync with `name`. Defaults to none —
   * a host that wants it says so, rather than inheriting it from whichever
   * models it happened to list above.
   */
  searchNameModels?: readonly string[];
}

/**
 * The configuration in force, declared ONCE at a host's composition root.
 *
 * A module-level declaration rather than a parameter on `getPrismaClient()`
 * because that function is called bare from hundreds of call sites in an
 * adopting host, and threading config through all of them would be a migration
 * out of proportion to the fix. Same shape as `useActorContextKey` in
 * `@12-apps/audit`, for the same reason.
 */
const declared: { config: AuditStampConfig } = { config: { trackedModels: [] } };

/**
 * Declare the models this host stamps. Call once, before the first client is
 * built.
 *
 * Nothing is stamped until this is called. That is deliberate and it is the
 * safe direction: attribution that never appears is a visibly empty column,
 * whereas guessing a foreign host's model names writes to tables the package
 * knows nothing about.
 */
export function configureAuditStamps(config: AuditStampConfig): void {
  declared.config = config;
}

/** The declared config — diagnostics and tests. */
export const auditStampConfig = (): AuditStampConfig => declared.config;

type MutableData = Record<string, unknown>;

/** Fill created_by + updated_by on a create payload (without clobbering overrides). */
function stampCreate(data: MutableData, userId: string): void {
  if (data.createdBy === undefined) data.createdBy = userId;
  if (data.updatedBy === undefined) data.updatedBy = userId;
}

/** Fill updated_by on an update payload. */
function stampUpdate(data: MutableData, userId: string): void {
  if (data.updatedBy === undefined) data.updatedBy = userId;
}

/**
 * Keep `search_name` in sync with `name` for accent/case-insensitive search
 * (FUT-168). Applied on every tracked write that sets `name` — including
 * system/seed writes with no actor — so the column never drifts. A caller that
 * sets `searchName` explicitly wins.
 */
function stampSearchName(data: MutableData): void {
  if (typeof data.name === 'string' && data.searchName === undefined) {
    data.searchName = normalizeSearchText(data.name);
  }
}

/**
 * Wrap a client so declared-model writes are attributed to the current actor.
 * Returns the client typed as {@link PrismaClient}: the extension only adds query
 * middleware (no new delegates), so every existing call site stays valid.
 *
 * `config` defaults to whatever {@link configureAuditStamps} declared, so the
 * common path is one declaration at the composition root and untouched call
 * sites. Passing it explicitly is for tests and for a host building more than
 * one client with different model sets.
 *
 * The two model lists are read ONCE here rather than per query: a declaration
 * that changed under a live client would stamp inconsistently across the same
 * request, which is worse than either setting.
 */
export function applyAuditStamps(
  client: PrismaClient,
  config: AuditStampConfig = declared.config,
): PrismaClient {
  const tracked = new Set(config.trackedModels);
  const searchable = new Set(config.searchNameModels ?? []);

  /** Both stamps for one payload, each gated on its OWN list. */
  const stampRow = (model: string, data: MutableData, userId: string | undefined, create: boolean) => {
    if (searchable.has(model)) stampSearchName(data);
    if (!userId || !tracked.has(model)) return;
    if (create) stampCreate(data, userId);
    else stampUpdate(data, userId);
  };

  /** Whether this model is in either list — the cheap early-out. */
  const touched = (model: string) => tracked.has(model) || searchable.has(model);

  const extended = client.$extends({
    name: 'auditStamps',
    query: {
      $allModels: {
        create({ model, args, query }) {
          if (touched(model) && args.data) {
            stampRow(model, args.data as MutableData, getActorUserId(), true);
          }
          return query(args);
        },
        createMany({ model, args, query }) {
          if (touched(model) && args.data) {
            const userId = getActorUserId();
            const rows = Array.isArray(args.data) ? args.data : [args.data];
            rows.forEach((row) => stampRow(model, row as MutableData, userId, true));
          }
          return query(args);
        },
        update({ model, args, query }) {
          if (touched(model) && args.data) {
            stampRow(model, args.data as MutableData, getActorUserId(), false);
          }
          return query(args);
        },
        updateMany({ model, args, query }) {
          if (touched(model) && args.data) {
            stampRow(model, args.data as MutableData, getActorUserId(), false);
          }
          return query(args);
        },
        upsert({ model, args, query }) {
          if (touched(model)) {
            const userId = getActorUserId();
            if (args.create) stampRow(model, args.create as MutableData, userId, true);
            if (args.update) stampRow(model, args.update as MutableData, userId, false);
          }
          return query(args);
        },
      },
    },
  });
  return extended as unknown as PrismaClient;
}
