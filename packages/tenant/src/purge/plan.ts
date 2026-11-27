/**
 * The erase plan: the config's tables compiled ONCE, at startup, into the
 * statements the purge issues, in order. Every table name comes from
 * `models.resolve` (the ORM's mapped name), every column from the host's
 * config; the tenant id is `$1`, a strip's values are `$2…`, and an entry's
 * fixed discriminators are bound after them. Nothing is spliced from input.
 *
 * Per entry:
 * - `erase`: ONE `DELETE`.
 * - `keepAndStrip` with `heldBy`, at its position: one `DELETE` per child of
 *   the held rows, the strip of the held rows, then the `DELETE` of every row
 *   no holder names (`children + 2`).
 * - `keepAndStrip` without `heldBy`: ONE `UPDATE`, after the whole order, in
 *   config order.
 * - `keep`: nothing.
 */
import type {
  TenantPurgeConfig,
  TenantPurgeEntry,
  TenantPurgeKey,
  TenantPurgeKeyThrough,
  TenantPurgeKeepAndStripEntry,
  TenantPurgePlanStep,
} from './types';

/** One statement of the erase, with the values it binds after the tenant id. */
export interface PurgeStatement {
  sql: string;
  /** Read at run time (a strip's values), then the fixed ones. */
  params: () => readonly unknown[];
}

export interface CompiledPlan {
  steps: readonly TenantPurgePlanStep[];
  /** The erase and held statements, in order, then the strips. */
  statements: readonly PurgeStatement[];
  /** The tables the erase empties (`erase` and `keepHeld`), in order: the audit line's `erased`. */
  erased: readonly string[];
}

const quote = (name: string): string => `"${name.replace(/"/gu, '""')}"`;

type Resolve = (model: string) => string;

/** A predicate naming the tenant, its placeholders numbered from `from`; answers the SQL and the fixed values. */
function plainPredicate(alias: string, key: TenantPurgeKey, from: number): { sql: string; fixed: string[] } {
  const parts = [`${alias}${quote(key.column)} = $1`];
  const fixed: string[] = [];
  for (const [column, value] of Object.entries(key.equals ?? {})) {
    fixed.push(value);
    parts.push(`${alias}${quote(column)} = $${from + fixed.length - 1}`);
  }
  return { sql: parts.join(' AND '), fixed };
}

function predicate(
  resolve: Resolve,
  alias: string,
  key: TenantPurgeKey | TenantPurgeKeyThrough,
  from: number,
): { sql: string; fixed: string[] } {
  if (!('through' in key)) return plainPredicate(alias, key, from);
  const { through } = key;
  const inner = plainPredicate('p.', through.key, from);
  return {
    sql: `${alias}${quote(through.column)} IN (SELECT p.${quote(through.references)} FROM ${quote(resolve(through.model))} p WHERE ${inner.sql})`,
    fixed: inner.fixed,
  };
}

/** The values a strip binds (`$2…`), read at run time, then the fixed ones. */
function paramsOf(values: readonly (() => string)[], fixed: readonly string[]): () => readonly unknown[] {
  return () => [...values.map((value) => value()), ...fixed];
}

function keyColumnOf(key: TenantPurgeKey | TenantPurgeKeyThrough): string {
  return 'through' in key ? key.through.key.column : key.column;
}

/** A row of the held table (aliased `t`) that a holder names, sharing the entry's key column. */
function heldExpression(resolve: Resolve, entry: TenantPurgeKeepAndStripEntry): string {
  const keyColumn = quote(keyColumnOf(entry.key));
  return (entry.heldBy?.holders ?? [])
    .map(
      (holder) =>
        `EXISTS (SELECT 1 FROM ${quote(resolve(holder.model))} h WHERE h.${keyColumn} = t.${keyColumn} AND h.${quote(holder.column)} = t.${quote(holder.matches)})`,
    )
    .join(' OR ');
}

function heldStatements(resolve: Resolve, entry: TenantPurgeKeepAndStripEntry): PurgeStatement[] {
  const table = quote(resolve(entry.model));
  const values = entry.strip.values ?? [];
  const where = predicate(resolve, 't.', entry.key, 2 + values.length);
  const held = heldExpression(resolve, entry);
  const fixedOnly = paramsOf([], predicate(resolve, 't.', entry.key, 2).fixed);
  const children = (entry.heldBy?.children ?? []).map((child) => {
    const ids = predicate(resolve, 't.', entry.key, 2);
    return {
      sql: `DELETE FROM ${quote(resolve(child.model))} WHERE ${quote(child.column)} IN (SELECT t.${quote(child.references)} FROM ${table} t WHERE ${ids.sql} AND (${held}))`,
      params: fixedOnly,
    };
  });
  return [
    ...children,
    {
      sql: `UPDATE ${table} t SET ${entry.strip.set} WHERE ${where.sql} AND (${held}) AND (${entry.strip.when})`,
      params: paramsOf(values, where.fixed),
    },
    { sql: `DELETE FROM ${table} t WHERE ${predicate(resolve, 't.', entry.key, 2).sql} AND NOT (${held})`, params: fixedOnly },
  ];
}

function stripStatement(resolve: Resolve, entry: TenantPurgeKeepAndStripEntry): PurgeStatement {
  const values = entry.strip.values ?? [];
  const where = predicate(resolve, '', entry.key, 2 + values.length);
  return {
    sql: `UPDATE ${quote(resolve(entry.model))} SET ${entry.strip.set} WHERE ${where.sql} AND (${entry.strip.when})`,
    params: paramsOf(values, where.fixed),
  };
}

function eraseStatement(resolve: Resolve, model: string, key: TenantPurgeKey | TenantPurgeKeyThrough): PurgeStatement {
  const where = predicate(resolve, '', key, 2);
  return { sql: `DELETE FROM ${quote(resolve(model))} WHERE ${where.sql}`, params: paramsOf([], where.fixed) };
}

function stepOf(resolve: Resolve, entry: TenantPurgeEntry): TenantPurgePlanStep {
  if (!('model' in entry)) return { table: entry.table, action: 'keep' };
  const table = resolve(entry.model);
  if (entry.action === 'erase' || entry.action === 'keep') return { table, action: entry.action, key: entry.key };
  if (entry.heldBy === undefined) return { table, action: 'strip', key: entry.key };
  return { table, action: 'keepHeld', key: entry.key, children: entry.heldBy.children.length };
}

/** Compile a VALIDATED config (every model resolves). */
export function compilePlan(config: Pick<TenantPurgeConfig, 'tables' | 'models'>): CompiledPlan {
  const resolve: Resolve = (model) => config.models.resolve(model) as string;
  const ordered: PurgeStatement[] = [];
  const strips: PurgeStatement[] = [];
  const erased: string[] = [];
  for (const entry of config.tables) {
    if (!('model' in entry) || entry.action === 'keep') continue;
    if (entry.action === 'erase') {
      ordered.push(eraseStatement(resolve, entry.model, entry.key));
      erased.push(resolve(entry.model));
    } else if (entry.heldBy === undefined) {
      strips.push(stripStatement(resolve, entry));
    } else {
      ordered.push(...heldStatements(resolve, entry));
      erased.push(resolve(entry.model));
    }
  }
  const steps = Object.freeze(config.tables.map((entry) => Object.freeze(stepOf(resolve, entry))));
  return { steps, statements: [...ordered, ...strips], erased: Object.freeze(erased) };
}
