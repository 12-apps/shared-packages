/**
 * The slug port: how the package reads the host's tenant row by its address.
 * The host owns the slug columns and the table of slugs a tenant held before
 * (a kept slug); the package owns none of them and reads both only here.
 */

/** What a slug resolves to: at least the tenant's id and its CURRENT slug; the host adds its own columns. */
export interface TenantSlugRecord {
  id: string;
  slug: string;
}

/** The tenant a unit's slug is unique within: its id and its tree path (`/<root>/…/<id>/`). */
export interface TenantSlugParent {
  id: string;
  path: string;
}

/**
 * Every member is ONE read. `parent` is null for a root lookup, whose slug is
 * globally unique; a tenant's slug under a parent is unique within that
 * parent only, and the host reads it there.
 */
export interface TenantSlugPort<R extends TenantSlugRecord = TenantSlugRecord> {
  /** The tenant whose CURRENT slug is `slug` (under `parent`), or null. */
  current(slug: string, parent: TenantSlugParent | null): Promise<R | null>;
  /**
   * The tenant that once held `slug` (under `parent`) and has since moved to
   * another, carrying its CURRENT slug; null when none did. A tenant keeps
   * every slug it ever held, so an old address is never handed to another.
   */
  former(slug: string, parent: TenantSlugParent | null): Promise<R | null>;
}

/** The slug port's members, in a fixed order: what startup validation checks. */
export const TENANT_SLUG_PORT_METHODS = ['current', 'former'] as const;
