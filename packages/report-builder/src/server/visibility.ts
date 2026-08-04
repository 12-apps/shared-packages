/**
 * Report lifecycle & sharing policy (FUT-307) — PURE functions over the
 * SavedReport lifecycle fields, shared by the host's list/get enforcement and
 * unit-testable without a database. The host resolves the actor (user id,
 * admin tier, role ids); this module only answers "may this actor see this
 * record?".
 */

/**
 * Lifecycle states. `archived` (FUT-391) is how an author RETIRES a report
 * without destroying it: the Relatórios picker stops offering it, but the
 * document (and every block spec in it) survives for restore. Deliberately a
 * status and not a delete — "arquivar" in the UI must be undoable, or authors
 * hoard dead reports rather than risk losing one.
 */
export const REPORT_STATUSES = ['draft', 'published', 'archived'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_VISIBILITIES = ['tenant', 'roles', 'private'] as const;
export type ReportVisibility = (typeof REPORT_VISIBILITIES)[number];

/** The lifecycle fields of a stored SavedReport row (values untrusted). */
export interface ReportVisibilityFields {
  status: string;
  visibility: string;
  /** JSON column: expected to be an array of host role-id strings. */
  visibilityRoles: unknown;
  createdBy: string | null;
}

/** The resolved caller, from the host's auth/RBAC layer. */
export interface ReportVisibilityActor {
  /** Host user id; null for identity-less grants (e.g. env superadmin). */
  userId: string | null;
  /** OWNER/ADMIN-tier (or platform-admin) callers see every document. */
  isAdmin: boolean;
  /** Every host role id the caller holds on this tenant. */
  roleIds: readonly string[];
}

/** The stored role-id allowlist, defensively narrowed to strings. */
export function visibilityRoleIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Whether the actor may SEE (list/open/run) the record. Admins always may;
 * anything not `published` (a draft, an archived report) is author-only beyond
 * that; a published record follows its visibility: tenant-wide, a role
 * allowlist (plus the author), or private (author only). Unknown/corrupt
 * values fail closed to author+admins.
 */
export function canViewSavedReport(
  record: ReportVisibilityFields,
  actor: ReportVisibilityActor,
): boolean {
  if (actor.isAdmin) return true;
  const isAuthor = record.createdBy !== null && record.createdBy === actor.userId;
  if (record.status !== 'published') return isAuthor;
  switch (record.visibility) {
    case 'tenant':
      return true;
    case 'roles':
      return (
        isAuthor ||
        visibilityRoleIds(record.visibilityRoles).some((id) => actor.roleIds.includes(id))
      );
    default:
      return isAuthor;
  }
}
