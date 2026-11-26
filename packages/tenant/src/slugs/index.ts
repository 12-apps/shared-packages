/**
 * Slug resolution: a tenant by its address, kept slugs included, from process
 * memory once resolved.
 *
 * - **Kept slugs**: a tenant keeps every slug it ever held. A lookup reads the
 *   CURRENT slug first and a former one only on a miss, so a known address
 *   costs one read and an old one two, as it always has.
 * - **Tree-aware**: a root's slug is globally unique and keys on the slug
 *   alone, so every address that resolves today keeps resolving. A unit's slug
 *   is unique within its parent: the lookup names the parent's path, and the
 *   key is that path plus the slug.
 * - **Kept until the database says it changed**: the memory is the host's
 *   (`createKeptMemory`), listening on the host's channel; only a found tenant
 *   is kept, so a stream of made-up slugs cannot grow it.
 */
import { parsePath } from '../tree/path';
import type { KeptMemory } from './memory';
import type { TenantSlugParent, TenantSlugPort, TenantSlugRecord } from './port';

export {
  EVERY_SCOPE,
  createKeptMemory,
  validateKeptMemoryOptions,
  type KeptMemory,
  type KeptMemoryErrorEvent,
  type KeptMemoryOptions,
  type KeptReadOptions,
  type TenantChangeHandlers,
  type TenantChangeListener,
} from './memory';
export {
  TENANT_SLUG_PORT_METHODS,
  type TenantSlugParent,
  type TenantSlugPort,
  type TenantSlugRecord,
} from './port';

/** Where a slug is looked up: under a parent (its tree path), or, left out, among the roots. */
export interface TenantSlugLookup {
  parentPath?: string;
}

/** The parent a lookup names, or null for a root lookup. Throws `TenantTreeError` on a bad path. */
function parentOf(lookup: TenantSlugLookup | undefined): TenantSlugParent | null {
  const path = lookup?.parentPath;
  if (path === undefined) return null;
  const ids = parsePath(path);
  return { id: ids[ids.length - 1] as string, path };
}

/**
 * The memory's key for a lookup, or null when it must not be kept: a root
 * keys on the slug (as every address before the tree did), a unit on its
 * parent's path plus the slug. A slug holding `/` is never a key (it could
 * pass for a path): it is loaded every time, never thrown on.
 */
function keyOf(slug: string, lookup: TenantSlugLookup | undefined): string | null {
  if (slug.includes('/')) return null;
  const parent = parentOf(lookup);
  return parent === null ? slug : `${parent.path}${slug}`;
}

export interface TenantSlugResolver<R extends TenantSlugRecord = TenantSlugRecord> {
  /** The tenant `slug` names, current first and a former slug only on a miss; null when none. Never kept. */
  load(slug: string, lookup?: TenantSlugLookup): Promise<R | null>;
}

export function createSlugResolver<R extends TenantSlugRecord>(port: TenantSlugPort<R>): TenantSlugResolver<R> {
  return {
    async load(slug, lookup) {
      const parent = parentOf(lookup);
      return (await port.current(slug, parent)) ?? (await port.former(slug, parent));
    },
  };
}

export interface KeptSlugs {
  /**
   * What `slug` resolves to, from memory once this process resolved it since
   * the last change, else from `load`. Only a non-null answer is kept; one
   * load for a burst of lookups of the same slug.
   */
  read<T>(slug: string, load: () => Promise<T | null>, lookup?: TenantSlugLookup): Promise<T | null>;
}

/** The slug half of a memory: one scope per address, one slot. */
export function createKeptSlugs(memory: KeptMemory): KeptSlugs {
  return {
    read(slug, load, lookup) {
      const key = keyOf(slug, lookup);
      if (key === null) return load();
      return memory.read(key, '', load, { keep: (value) => value !== null });
    },
  };
}

export interface TenantSlugs<R extends TenantSlugRecord = TenantSlugRecord> extends TenantSlugResolver<R> {
  /**
   * The tenant `slug` names, kept: from memory when resolved since the last
   * change, else through the port. Shares its key and slot with `remember`:
   * for a given slug a host uses one or the other, never both, or each would
   * be answered with what the other kept.
   */
  resolve(slug: string, lookup?: TenantSlugLookup): Promise<R | null>;
  /**
   * Keep a host's own reading of a slug in the same memory (a host that reads
   * more than the port does). Same key and slot as `resolve`: use one or the
   * other for a given slug.
   */
  remember: KeptSlugs['read'];
}

/** The port, resolved through the memory. */
export function createTenantSlugs<R extends TenantSlugRecord>(config: {
  port: TenantSlugPort<R>;
  memory: KeptMemory;
}): TenantSlugs<R> {
  const resolver = createSlugResolver(config.port);
  const kept = createKeptSlugs(config.memory);
  return {
    load: resolver.load,
    resolve: (slug, lookup) => kept.read(slug, () => resolver.load(slug, lookup), lookup),
    remember: kept.read,
  };
}
