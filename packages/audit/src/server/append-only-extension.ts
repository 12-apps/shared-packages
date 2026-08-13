/**
 * Prisma client extension that makes the audit log physically append-only at the
 * client layer (12-14).
 *
 * The trail's value rests on immutability: an entry that can be edited or deleted
 * after the fact proves nothing. There is no code path that should ever mutate
 * `audit_logs`, so every update/upsert/delete delegate on the model throws —
 * including the batch variants — before reaching the database.
 *
 * ## What this does NOT cover
 *
 * **Raw SQL.** `$executeRaw` / `$executeRawUnsafe` / `$queryRaw` bypass model
 * delegates entirely and are untouched by this extension, so anyone holding the
 * client can `DELETE FROM audit_logs` and nothing here objects. That is not an
 * oversight: it is the ONLY way the retention sweep can run at all
 * (`retention.ts` uses it, deliberately and narrowly), and test truncation uses
 * it for the same reason.
 *
 * The guard therefore stops the ACCIDENT — a helper that upserts, a bulk update
 * that catches the wrong model, a "fix the row" script written in Prisma — and
 * not a determined operator. Guarantees at that level need database privileges (a
 * role with no DELETE on the table) or a trigger; the host owns both, and
 * ADOPTING.md says so.
 *
 * **Another connection.** psql, a migration, a second client without the
 * extension: all unaffected. This is a client-layer discipline, not a constraint.
 *
 * **NESTED relation writes.** Prisma's `query.$allModels` hooks fire for the
 * TOP-LEVEL model and operation only, so a guarded model reached through a
 * parent's relation payload is invisible here:
 *
 *     prisma.account.update({ where, data: { entries: { deleteMany: {} } } })
 *
 * deletes guarded `entries` rows with no {@link AppendOnlyViolationError} — the
 * hook saw `Account` + `update`, both unguarded. This does NOT apply to
 * `AuditLog`: the package's partial declares no `@relation`, Prisma requires both
 * sides of one, and the partial is package-owned with a drift `--check`, so a host
 * cannot reach the audit table this way without failing its own build. It DOES
 * apply to whatever a host adds through `appendOnlyModels`, where an immutable
 * table almost certainly has a parent. Guard those at the database (privileges or
 * a trigger), or keep their writes off the parent's payload.
 */

/** Thrown when code attempts to mutate an append-only model. */
export class AppendOnlyViolationError extends Error {
  constructor(model: string, operation: string) {
    super(
      `${model} is append-only: "${operation}" is not allowed. ` +
        'Audit entries are immutable; retention sweeps use raw SQL.',
    );
    this.name = 'AppendOnlyViolationError';
    Object.setPrototypeOf(this, AppendOnlyViolationError.prototype);
  }
}

/** The `$extends` slice of a Prisma-shaped client (see audit-extension.ts). */
interface Extendable {
  $extends(extension: unknown): unknown;
}

type QueryHookArgs = {
  model: string;
  args: Record<string, unknown>;
  query: (args: Record<string, unknown>) => unknown;
};

/** The delegates a write can reach a row through. */
const GUARDED_OPERATIONS = [
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
] as const;

export interface AppendOnlyConfig {
  /** Prisma model names that must never be updated or deleted via the model API. */
  models: readonly string[];
}

/**
 * Wrap a client so mutating operations on append-only models throw. Returns the
 * client typed as it came in: the extension only adds query middleware.
 */
export function applyAppendOnlyGuard<T>(client: T, config: AppendOnlyConfig): T {
  const guarded = new Set(config.models);
  const hook =
    (operation: string) =>
    ({ model, args, query }: QueryHookArgs): unknown => {
      if (guarded.has(model)) throw new AppendOnlyViolationError(model, operation);
      return query(args);
    };
  const extended = (client as unknown as Extendable).$extends({
    name: 'appendOnlyGuard',
    query: {
      $allModels: Object.fromEntries(
        GUARDED_OPERATIONS.map((operation) => [operation, hook(operation)]),
      ),
    },
  });
  return extended as unknown as T;
}
