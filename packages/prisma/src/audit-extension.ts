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

/** Prisma model names that carry `created_by`/`updated_by` + `search_name`. */
const TRACKED_MODELS = new Set([
  'MenuItem',
  'InventoryItem',
  'ProductCategory',
  'Supplier',
  'Discount',
]);

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
 * Wrap a client so tracked-model writes are attributed to the current actor.
 * Returns the client typed as {@link PrismaClient}: the extension only adds query
 * middleware (no new delegates), so every existing call site stays valid.
 */
export function applyAuditStamps(client: PrismaClient): PrismaClient {
  const extended = client.$extends({
    name: 'auditStamps',
    query: {
      $allModels: {
        create({ model, args, query }) {
          if (TRACKED_MODELS.has(model) && args.data) {
            const data = args.data as MutableData;
            stampSearchName(data);
            const userId = getActorUserId();
            if (userId) stampCreate(data, userId);
          }
          return query(args);
        },
        createMany({ model, args, query }) {
          if (TRACKED_MODELS.has(model) && args.data) {
            const userId = getActorUserId();
            const rows = Array.isArray(args.data) ? args.data : [args.data];
            rows.forEach((row) => {
              const data = row as MutableData;
              stampSearchName(data);
              if (userId) stampCreate(data, userId);
            });
          }
          return query(args);
        },
        update({ model, args, query }) {
          if (TRACKED_MODELS.has(model) && args.data) {
            const data = args.data as MutableData;
            stampSearchName(data);
            const userId = getActorUserId();
            if (userId) stampUpdate(data, userId);
          }
          return query(args);
        },
        updateMany({ model, args, query }) {
          if (TRACKED_MODELS.has(model) && args.data) {
            const data = args.data as MutableData;
            stampSearchName(data);
            const userId = getActorUserId();
            if (userId) stampUpdate(data, userId);
          }
          return query(args);
        },
        upsert({ model, args, query }) {
          if (TRACKED_MODELS.has(model)) {
            const userId = getActorUserId();
            if (args.create) {
              const data = args.create as MutableData;
              stampSearchName(data);
              if (userId) stampCreate(data, userId);
            }
            if (args.update) {
              const data = args.update as MutableData;
              stampSearchName(data);
              if (userId) stampUpdate(data, userId);
            }
          }
          return query(args);
        },
      },
    },
  });
  return extended as unknown as PrismaClient;
}
