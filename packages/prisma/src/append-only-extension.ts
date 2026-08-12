/**
 * Prisma client extension that makes the audit log physically append-only at
 * the client layer (FUT-209).
 *
 * The audit trail's value rests on immutability: an entry that can be edited
 * or deleted after the fact proves nothing. There is no code path that should
 * ever mutate `audit_logs`, so every update/upsert/delete delegate on the
 * model throws — including the batch variants — before reaching the database.
 * The house pattern for append-only tables (entity_versions) relies on code
 * discipline alone; the audit log gets the harder guard because it exists
 * precisely for the cases where discipline failed.
 *
 * The ONLY sanctioned removal is the retention sweep (12-month policy), which
 * runs raw SQL over `created_at` — `$executeRaw` bypasses model delegates and
 * is untouched by this extension. Test truncation uses raw SQL for the same
 * reason.
 */

import type { PrismaClient } from '@prisma/client';

/** Prisma model names that must never be updated or deleted via the model API. */
const APPEND_ONLY_MODELS = new Set(['AuditLog']);

/** Thrown when code attempts to mutate an append-only model. */
export class AppendOnlyViolationError extends Error {
  constructor(model: string, operation: string) {
    super(
      `${model} is append-only: "${operation}" is not allowed. ` +
        'Audit entries are immutable; retention sweeps use raw SQL.',
    );
    this.name = 'AppendOnlyViolationError';
  }
}

/** Throw for an append-only model, else pass the call through untouched. */
function guard<A, R>(model: string, operation: string, args: A, query: (args: A) => R): R {
  if (APPEND_ONLY_MODELS.has(model)) {
    throw new AppendOnlyViolationError(model, operation);
  }
  return query(args);
}

/**
 * Wrap a client so mutating operations on append-only models throw.
 * Returns the client typed as {@link PrismaClient}: the extension only adds
 * query middleware (no new delegates), so every existing call site stays valid.
 */
export function applyAppendOnlyGuard(client: PrismaClient): PrismaClient {
  const extended = client.$extends({
    name: 'appendOnlyGuard',
    query: {
      $allModels: {
        update({ model, args, query }) {
          return guard(model, 'update', args, query);
        },
        updateMany({ model, args, query }) {
          return guard(model, 'updateMany', args, query);
        },
        updateManyAndReturn({ model, args, query }) {
          return guard(model, 'updateManyAndReturn', args, query);
        },
        upsert({ model, args, query }) {
          return guard(model, 'upsert', args, query);
        },
        delete({ model, args, query }) {
          return guard(model, 'delete', args, query);
        },
        deleteMany({ model, args, query }) {
          return guard(model, 'deleteMany', args, query);
        },
      },
    },
  });
  return extended as unknown as PrismaClient;
}
