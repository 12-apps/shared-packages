/**
 * The `Role.permissions` DB string codec (12-13) — stored as the literal `'*'`
 * (wildcard) or a JSON array of permission strings. One module so the seed,
 * the resolver and the stores can never disagree about the format.
 */

/** Parse a `Role.permissions` DB string into the engine's permission shape. */
export function parseRolePermissions(raw: string): readonly string[] | '*' {
  if (raw === '*') return '*';
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((p) => typeof p !== 'string')) {
    throw new Error(`Malformed Role.permissions (expected '*' or string[]): ${raw}`);
  }
  return parsed as readonly string[];
}

/** Serialize a permission set to the DB string. */
export function serializeRolePermissions(permissions: readonly string[] | '*'): string {
  return permissions === '*' ? '*' : JSON.stringify(permissions);
}

/** Compound key for a per-tenant role: a space join can't collide with an id. */
export function tenantRoleKey(clientId: string, name: string): string {
  return `${clientId} ${name}`;
}
