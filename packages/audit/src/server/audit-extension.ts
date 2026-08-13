/**
 * Prisma client extension that auto-stamps change attribution (12-14).
 *
 * For the TRACKED models it fills `createdBy` on create and `updatedBy` on
 * create/update from the current actor context, so repositories and actions never
 * pass an actor id explicitly. A write with no actor in scope (system, seed,
 * unauthenticated) is left untouched — the columns stay NULL. Only fields the
 * caller did not already set are filled, so an explicit override always wins.
 *
 * The model set is CONFIG. In future-pay it was a `TRACKED_MODELS` constant
 * inside this file — five restaurant model names hard-coded in otherwise generic
 * machinery, which is exactly the thing that made the file unportable.
 *
 * ## What this does NOT cover
 *
 * **NESTED relation writes**, the same blind spot the append-only guard has and
 * for the same reason: Prisma's `query.$allModels` hooks fire for the TOP-LEVEL
 * model and operation only. A tracked model created through a parent's relation
 * payload —
 *
 *     prisma.order.create({ data: { …, items: { create: [{ … }] } } })
 *
 * — never reaches the hook, so its `created_by`/`updated_by` stay NULL with no
 * error. Silent, and it looks exactly like a system write. A tracked model whose
 * attribution must always be present is written at the TOP level, or the columns
 * are filled by the caller.
 *
 * **Raw SQL.** `$executeRaw*` / `$queryRaw*` never reach a model delegate.
 */
import { getActorUserId } from './actor-context';

/**
 * The `$extends` slice of a Prisma-shaped client.
 *
 * Deliberately structural and deliberately loose: typing this against
 * `PrismaClient` would make `@prisma/client` a dependency of a package that
 * never generates one, and Prisma's own `$extends` signature is generic enough
 * that a hand-written constraint rejects the real client. The generic parameter
 * is returned unchanged, so a host's call site keeps its fully-typed client (the
 * same `as unknown as` shape future-pay used).
 */
interface Extendable {
  $extends(extension: unknown): unknown;
}

/** One `query.$allModels` hook, as Prisma calls it. */
type QueryHookArgs = {
  model: string;
  args: Record<string, unknown>;
  query: (args: Record<string, unknown>) => unknown;
};

type MutableData = Record<string, unknown>;

export interface AuditStampConfig {
  /** Prisma model names that carry the attribution columns. */
  trackedModels: readonly string[];
  /** Column names, when a host spells them differently. */
  columns?: { createdBy?: string; updatedBy?: string };
  /**
   * Extra per-write derivation on a tracked model's payload — the seam
   * future-pay needs for the `search_name` column it keeps in sync on the same
   * writes. Runs for EVERY tracked write, including system/seed writes with no
   * actor, so a derived column never drifts. Mutate `data` in place.
   */
  deriveFields?: (model: string, data: MutableData) => void;
}

/** Fill created_by + updated_by on a create payload (never clobbering an override). */
function stampCreate(data: MutableData, userId: string, created: string, updated: string): void {
  if (data[created] === undefined) data[created] = userId;
  if (data[updated] === undefined) data[updated] = userId;
}

/** Fill updated_by on an update payload. */
function stampUpdate(data: MutableData, userId: string, updated: string): void {
  if (data[updated] === undefined) data[updated] = userId;
}

/**
 * Wrap a client so tracked-model writes are attributed to the current actor.
 * Returns the client typed as it came in: the extension only adds query
 * middleware (no new delegates), so every existing call site stays valid.
 */
export function applyAuditStamps<T>(client: T, config: AuditStampConfig): T {
  const tracked = new Set(config.trackedModels);
  const created = config.columns?.createdBy ?? 'createdBy';
  const updated = config.columns?.updatedBy ?? 'updatedBy';
  const derive = config.deriveFields;

  /** Prepare one payload: derived columns always, attribution when there is an actor. */
  const prepare = (model: string, payload: unknown, mode: 'create' | 'update'): void => {
    if (!payload || typeof payload !== 'object') return;
    const data = payload as MutableData;
    derive?.(model, data);
    const userId = getActorUserId();
    if (!userId) return;
    if (mode === 'create') stampCreate(data, userId, created, updated);
    else stampUpdate(data, userId, updated);
  };

  const hook =
    (mode: 'create' | 'update') =>
    ({ model, args, query }: QueryHookArgs): unknown => {
      if (tracked.has(model) && args.data) prepare(model, args.data, mode);
      return query(args);
    };

  const manyHook =
    (mode: 'create' | 'update') =>
    ({ model, args, query }: QueryHookArgs): unknown => {
      if (tracked.has(model) && args.data) {
        const rows = Array.isArray(args.data) ? args.data : [args.data];
        rows.forEach((row) => prepare(model, row, mode));
      }
      return query(args);
    };

  const extended = (client as unknown as Extendable).$extends({
    name: 'auditStamps',
    query: {
      $allModels: {
        create: hook('create'),
        createMany: manyHook('create'),
        update: hook('update'),
        updateMany: manyHook('update'),
        upsert({ model, args, query }: QueryHookArgs) {
          if (tracked.has(model)) {
            prepare(model, args.create, 'create');
            prepare(model, args.update, 'update');
          }
          return query(args);
        },
      },
    },
  });
  return extended as unknown as T;
}
