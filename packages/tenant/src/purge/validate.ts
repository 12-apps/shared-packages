/**
 * Startup validation of the purge engine's config, read as `unknown` like the
 * rest of the package's: every missing or bad key is named
 * (`TenantConfigError`), and nothing falls back to a value of the host's.
 * Every model an entry names must resolve through `models.resolve`, and a raw
 * table name is accepted only on a `keep` entry, which no SQL reaches.
 */
import { TenantConfigError } from '../validate';

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function present(value: unknown, key: string): void {
  if (value === undefined || value === null) throw new TenantConfigError(key, 'is required and missing');
}

function bagAt(value: unknown, key: string): Bag {
  present(value, key);
  if (!isBag(value)) throw new TenantConfigError(key, 'must be an object');
  return value;
}

function textAt(value: unknown, key: string): string {
  present(value, key);
  if (typeof value !== 'string' || value.trim() === '') throw new TenantConfigError(key, 'must be a non-empty string');
  return value;
}

function fnAt(bag: Bag, member: string, key: string): void {
  present(bag[member], key);
  if (typeof bag[member] !== 'function') throw new TenantConfigError(key, 'must be a function');
}

function listAt(value: unknown, key: string): unknown[] {
  present(value, key);
  if (!Array.isArray(value)) throw new TenantConfigError(key, 'must be an array');
  return value;
}

/** What validating an entry needs: the resolver and the key columns. */
interface Scope {
  resolve(model: string): string | null;
  keyColumns: ReadonlySet<string>;
}

/** The model's mapped name, or the error naming it. */
function resolvedAt(scope: Pick<Scope, 'resolve'>, value: unknown, key: string): string {
  const model = textAt(value, key);
  const table = scope.resolve(model);
  if (typeof table !== 'string' || table === '') {
    throw new TenantConfigError(key, `names the model "${model}", which models.resolve does not know`);
  }
  return table;
}

function validateEquals(value: unknown, key: string): void {
  if (value === undefined) return;
  const equals = bagAt(value, key);
  for (const [column, fixed] of Object.entries(equals)) textAt(fixed, `${key}.${column}`);
}

function validatePlainKey(scope: Scope, value: unknown, key: string): void {
  const bag = bagAt(value, key);
  const column = textAt(bag.column, `${key}.column`);
  if (!scope.keyColumns.has(column)) throw new TenantConfigError(`${key}.column`, `is "${column}", which keyColumns does not list`);
  validateEquals(bag.equals, `${key}.equals`);
}

function validateKey(scope: Scope, value: unknown, key: string): void {
  const bag = bagAt(value, key);
  if (bag.through === undefined) {
    validatePlainKey(scope, bag, key);
    return;
  }
  const through = bagAt(bag.through, `${key}.through`);
  resolvedAt(scope, through.model, `${key}.through.model`);
  textAt(through.column, `${key}.through.column`);
  textAt(through.references, `${key}.through.references`);
  validatePlainKey(scope, through.key, `${key}.through.key`);
}

function validateStrip(value: unknown, key: string): void {
  const strip = bagAt(value, key);
  textAt(strip.set, `${key}.set`);
  textAt(strip.when, `${key}.when`);
  if (strip.values === undefined) return;
  listAt(strip.values, `${key}.values`).forEach((fn, index) => {
    if (typeof fn !== 'function') throw new TenantConfigError(`${key}.values[${index}]`, 'must be a function');
  });
}

function validateHeldBy(scope: Scope, value: unknown, key: string): void {
  if (value === undefined) return;
  const held = bagAt(value, key);
  const holders = listAt(held.holders, `${key}.holders`);
  if (holders.length === 0) throw new TenantConfigError(`${key}.holders`, 'must name at least one holder');
  holders.forEach((entry, index) => {
    const holder = bagAt(entry, `${key}.holders[${index}]`);
    resolvedAt(scope, holder.model, `${key}.holders[${index}].model`);
    textAt(holder.column, `${key}.holders[${index}].column`);
    textAt(holder.matches, `${key}.holders[${index}].matches`);
  });
  listAt(held.children, `${key}.children`).forEach((entry, index) => {
    const child = bagAt(entry, `${key}.children[${index}]`);
    resolvedAt(scope, child.model, `${key}.children[${index}].model`);
    textAt(child.column, `${key}.children[${index}].column`);
    textAt(child.references, `${key}.children[${index}].references`);
  });
}

const ACTIONS = new Set(['erase', 'keep', 'keepAndStrip']);

/** One entry; answers its mapped table name. */
function validateEntry(scope: Scope, value: unknown, key: string): string {
  const entry = bagAt(value, key);
  const action = textAt(entry.action, `${key}.action`);
  if (!ACTIONS.has(action)) throw new TenantConfigError(`${key}.action`, `is "${action}", not erase, keep or keepAndStrip`);
  if (entry.model === undefined) {
    if (action !== 'keep' || entry.table === undefined) {
      throw new TenantConfigError(`${key}.model`, 'is required: only a kept table may be named by a raw table name');
    }
    textAt(entry.law, `${key}.law`);
    return textAt(entry.table, `${key}.table`);
  }
  if (entry.table !== undefined) throw new TenantConfigError(`${key}.table`, 'is given with a model: name one or the other');
  const table = resolvedAt(scope, entry.model, `${key}.model`);
  validateKey(scope, entry.key, `${key}.key`);
  if (action === 'erase') return table;
  textAt(entry.law, `${key}.law`);
  if (action === 'keepAndStrip') {
    validateStrip(entry.strip, `${key}.strip`);
    validateHeldBy(scope, entry.heldBy, `${key}.heldBy`);
  }
  return table;
}

function validateTables(scope: Scope, value: unknown): void {
  const seen = new Map<string, number>();
  listAt(value, 'purge.tables').forEach((entry, index) => {
    const table = validateEntry(scope, entry, `purge.tables[${index}]`);
    const first = seen.get(table);
    if (first !== undefined) throw new TenantConfigError(`purge.tables[${index}]`, `repeats "${table}", already purge.tables[${first}]`);
    seen.set(table, index);
  });
}

function validateKeyColumns(value: unknown): Set<string> {
  const list = listAt(value, 'purge.keyColumns');
  if (list.length === 0) throw new TenantConfigError('purge.keyColumns', 'must name at least one column');
  return new Set(list.map((column, index) => textAt(column, `purge.keyColumns[${index}]`)));
}

function validateImages(config: Bag): void {
  const storage = bagAt(config.storage, 'purge.storage');
  for (const member of ['discard', 'members', 'state'] as const) fnAt(storage, member, `purge.storage.${member}`);
  fnAt(config, 'parseKey', 'purge.parseKey');
  present(config.unscopedKeys, 'purge.unscopedKeys');
  if (config.unscopedKeys !== 'accept' && config.unscopedKeys !== 'reject') {
    throw new TenantConfigError('purge.unscopedKeys', 'must be "accept" or "reject"');
  }
  present(config.imageChunk, 'purge.imageChunk');
  const chunk = config.imageChunk;
  if (typeof chunk !== 'number' || !Number.isInteger(chunk) || chunk <= 0) {
    throw new TenantConfigError('purge.imageChunk', 'must be a whole number above 0');
  }
}

const CALLBACKS = ['revokeCredentials', 'collectImageKeys', 'heldElsewhere', 'zeroBalances', 'audit', 'mirrorClosing'] as const;

/** The purge's config. Answers the package's own closing table, as `models.resolve` maps it. */
export function validatePurge(value: unknown): { closings: string } {
  const config = bagAt(value, 'purge');
  const keyColumns = validateKeyColumns(config.keyColumns);
  const models = bagAt(config.models, 'purge.models');
  fnAt(models, 'resolve', 'purge.models.resolve');
  const resolve = models.resolve as Scope['resolve'];
  const scope: Scope = { resolve: (model) => resolve(model), keyColumns };
  const db = bagAt(config.db, 'purge.db');
  for (const member of ['transaction', 'execute', 'query'] as const) fnAt(db, member, `purge.db.${member}`);
  for (const callback of CALLBACKS) fnAt(config, callback, `purge.${callback}`);
  listAt(config.beforeErase, 'purge.beforeErase').forEach((hook, index) => {
    if (typeof hook !== 'function') throw new TenantConfigError(`purge.beforeErase[${index}]`, 'must be a function');
  });
  validateImages(config);
  validateTables(scope, config.tables);
  return { closings: resolvedAt(scope, 'TenantClosing', 'purge.models.resolve("TenantClosing")') };
}

const LIFECYCLE_HOOKS = ['invalidate', 'onError'] as const;

/** The lifecycle pieces the engine reuses. */
export function validatePurgeLifecycle(value: unknown): void {
  const lifecycle = bagAt(value, 'lifecycle');
  for (const hook of LIFECYCLE_HOOKS) fnAt(lifecycle, hook, `lifecycle.${hook}`);
  const db = bagAt(lifecycle.db, 'lifecycle.db');
  fnAt(db, 'table', 'lifecycle.db.table');
  const batch = lifecycle.sweepBatch;
  if (typeof batch !== 'number' || !Number.isInteger(batch) || batch <= 0) {
    throw new TenantConfigError('lifecycle.sweepBatch', 'must be a whole number above 0');
  }
}
