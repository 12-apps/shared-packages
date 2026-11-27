/**
 * The classification, for the host's tests: every table of its catalogue that
 * holds a tenant key has ONE action in the purge config, and no erased table
 * cascades into a kept one. The host reads its own catalogue (a schema scan,
 * or the real database's) and names its key columns; the package names none.
 *
 * Throws ONE error listing every finding:
 * - `<table>: holds a tenant key (<column>) and is in no list`;
 * - `<table>: is in the config but not in the catalogue`;
 * - `<child> <- <parent>`: a kept child that a delete of an erased table
 *   reaches by cascade, directly or through tables of no tenant key (`(reached
 *   from <erased>)` names where it started); the reach is closed to a fixpoint.
 *   A `keepAndStrip` with `heldBy` may cascade into its own holders: it
 *   erases only the rows no holder names;
 * - `<child> -> <parent>` (with `restricts`): an erased child after the erased
 *   parent its key restricts, so the parent's delete would fail.
 */
import { compilePlan } from './plan';
import type { TenantPurgeConfig, TenantPurgePlanStep } from './types';
import { validatePurge } from './validate';

export interface TenantPurgeCatalog {
  tables: readonly { table: string; columns: readonly string[] }[];
  /** Foreign keys whose delete cascades from `parent` to `child`. */
  cascades: readonly { child: string; parent: string }[];
  /** Foreign keys that refuse a parent's delete while a child names it. */
  restricts?: readonly { child: string; parent: string }[];
}

export interface TenantPurgeClassificationOptions {
  /** The key-column names a row may name the tenant by. */
  keyColumns: readonly string[];
  /** Tables whose column of such a name holds something else. */
  notATenantKey: readonly string[];
}

/** The holders of each held table, by mapped name. */
function holdersOf(config: Pick<TenantPurgeConfig, 'tables' | 'models'>): Map<string, Set<string>> {
  const resolve = (model: string) => config.models.resolve(model) as string;
  const map = new Map<string, Set<string>>();
  for (const entry of config.tables) {
    if (entry.action !== 'keepAndStrip' || entry.heldBy === undefined) continue;
    map.set(resolve(entry.model), new Set(entry.heldBy.holders.map((holder) => resolve(holder.model))));
  }
  return map;
}

function unclassified(catalog: TenantPurgeCatalog, steps: ReadonlyMap<string, TenantPurgePlanStep>, options: TenantPurgeClassificationOptions): string[] {
  const keys = new Set(options.keyColumns);
  const exempt = new Set(options.notATenantKey);
  return catalog.tables.flatMap(({ table, columns }) => {
    const key = columns.find((column) => keys.has(column));
    if (key === undefined || exempt.has(table) || steps.has(table)) return [];
    return [`${table}: holds a tenant key (${key}) and is in no list`];
  });
}

type Edge = { child: string; parent: string };

/** Whether `table`'s rows survive the purge (kept, stripped, or held). */
function keptIn(steps: ReadonlyMap<string, TenantPurgePlanStep>, table: string): boolean {
  const action = steps.get(table)?.action;
  return action === 'keep' || action === 'strip' || action === 'keepHeld';
}

/** An edge the erase's delete never follows: a held table into its own holders (it deletes only rows no holder names). */
function exempt(holders: Map<string, Set<string>>, edge: Edge): boolean {
  return holders.get(edge.parent)?.has(edge.child) === true;
}

/**
 * Every table a delete of an erased table reaches by cascade, through tables
 * holding no tenant key too (an erased A, a keyless B, a kept C: deleting A
 * deletes C's rows), with the erased table each was reached from. A fixpoint
 * by breadth: a kept table reached is a finding and is not walked past.
 */
function reachOf(catalog: TenantPurgeCatalog, steps: ReadonlyMap<string, TenantPurgePlanStep>, holders: Map<string, Set<string>>, erased: readonly string[]): Map<string, string> {
  const below = new Map<string, Edge[]>();
  catalog.cascades.forEach((edge) => below.set(edge.parent, [...(below.get(edge.parent) ?? []), edge]));
  const reached = new Map<string, string>(erased.map((table) => [table, table]));
  const queue = [...erased];
  const visit = (from: string, edge: Edge): void => {
    if (exempt(holders, edge) || reached.has(edge.child)) return;
    reached.set(edge.child, reached.get(from) ?? from);
    if (!keptIn(steps, edge.child)) queue.push(edge.child);
  };
  while (queue.length > 0) {
    const table = queue.shift() as string;
    (below.get(table) ?? []).forEach((edge) => visit(table, edge));
  }
  return reached;
}

/** Every cascade edge into a kept table from a table the erase reaches (`child <- parent`, and its erased origin when indirect). */
function cascading(catalog: TenantPurgeCatalog, steps: ReadonlyMap<string, TenantPurgePlanStep>, holders: Map<string, Set<string>>, erased: readonly string[]): string[] {
  const reached = reachOf(catalog, steps, holders, erased);
  const deleting = new Set(erased);
  // A kept table the reach met is reported by its own incoming edge, not again for what lies below it.
  const deletes = (table: string) => reached.has(table) && (deleting.has(table) || !keptIn(steps, table));
  return catalog.cascades.flatMap((edge) => {
    const origin = reached.get(edge.parent);
    if (origin === undefined || !deletes(edge.parent) || !keptIn(steps, edge.child) || exempt(holders, edge)) return [];
    return [origin === edge.parent ? `${edge.child} <- ${edge.parent}` : `${edge.child} <- ${edge.parent} (reached from ${origin})`];
  });
}

function blocking(catalog: TenantPurgeCatalog, order: readonly string[]): string[] {
  const at = new Map(order.map((table, index) => [table, index]));
  return (catalog.restricts ?? []).flatMap(({ child, parent }) => {
    const childAt = at.get(child);
    const parentAt = at.get(parent);
    if (child === parent || childAt === undefined || parentAt === undefined || childAt < parentAt) return [];
    return [`${child} -> ${parent}`];
  });
}

/** Throws naming every finding; returns when the catalogue is fully and safely classified. */
export function assertPurgeClassification(
  catalog: TenantPurgeCatalog,
  config: Pick<TenantPurgeConfig, 'tables' | 'models'>,
  options: TenantPurgeClassificationOptions,
): void {
  validatePurge({ ...placeholderConfig(options), tables: config.tables, models: config.models });
  const plan = compilePlan(config);
  const steps = new Map(plan.steps.map((step) => [step.table, step]));
  const present = new Set(catalog.tables.map(({ table }) => table));
  const findings = [
    ...unclassified(catalog, steps, options),
    ...plan.steps.filter((step) => !present.has(step.table)).map((step) => `${step.table}: is in the config but not in the catalogue`),
    ...cascading(catalog, steps, holdersOf(config), plan.erased),
    ...blocking(catalog, plan.erased),
  ];
  if (findings.length > 0) {
    throw new Error(`@12-apps/tenant: the purge's classification has ${findings.length} finding(s):\n${findings.join('\n')}`);
  }
}

const noop = async (): Promise<never> => {
  throw new Error('not called');
};

/** The callbacks validation asks for, which the classification never calls: only the tables and keys are checked. */
function placeholderConfig(options: TenantPurgeClassificationOptions): Record<string, unknown> {
  return {
    keyColumns: options.keyColumns,
    db: { transaction: noop, execute: noop, query: noop },
    revokeCredentials: noop,
    collectImageKeys: noop,
    heldElsewhere: noop,
    beforeErase: [],
    zeroBalances: noop,
    audit: noop,
    mirrorClosing: noop,
    storage: { discard: noop, members: noop, state: noop },
    parseKey: noop,
    unscopedKeys: 'reject',
    imageChunk: 1,
  };
}
