/**
 * The config a host DECLARES, turned into the policy this surface RUNS — and
 * every refusal that turn makes.
 *
 * Separate from `config.ts` (which holds the types, the defaults and the
 * response envelope) because these four functions are the assembly-time guard,
 * and they are called from `createApiAudit` so a host meets every one of them at
 * boot rather than on the request that trips it.
 *
 * Each refusal below is a fail-OPEN or a silently-inert setting, never a matter
 * of taste: a blank message renders a denial as an empty box, a blank
 * permission id asks a catalog for a grant nothing issues (and matches a
 * resolver that returns `['']`), an unbounded page size is an `OFFSET` a URL can
 * choose, and a model name with a trailing space matches no model at all.
 */
import { AuditConfigError } from '../core/errors';

import {
  DEFAULT_GATE_PERMISSIONS,
  DEFAULT_MESSAGES,
  DEFAULT_PAGINATION,
  type AuditGatePermissions,
  type AuditMessages,
  type AuditPagingPolicy,
  type AuditServerConfig,
} from './config';

/**
 * The messages in force.
 *
 * A blank override is REFUSED rather than merged: `{ forbidden: '' }` produces
 * `{ error: '' }` on the wire, and the packaged viewer prints the server's own
 * message in place of its generic one — so a denial renders as an empty box
 * with a retry button, which reads as a broken screen rather than a refusal.
 * The likely source is a host threading its copy through a lookup that missed.
 */
export const messagesOf = (config: Pick<AuditServerConfig, 'messages'>): AuditMessages => {
  const merged = { ...DEFAULT_MESSAGES, ...config.messages };
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new AuditConfigError(`messages.${key}`, 'must be a non-blank string.');
    }
  }
  return merged;
};

/**
 * The gate permission ids in force.
 *
 * A blank id is REFUSED: `requirePermission` would then ask whether the caller
 * holds `''`, which no catalog issues — so every reader is refused and the
 * surface looks broken rather than mis-wired. The reverse is worse and is why
 * the check is here rather than at the call site: a host whose permission
 * resolver returns `['']` for an unknown grant would pass the gate.
 */
export const gatesOf = (
  config: Pick<AuditServerConfig, 'gatePermissions'>,
): AuditGatePermissions => {
  const merged = { ...DEFAULT_GATE_PERMISSIONS, ...config.gatePermissions };
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new AuditConfigError(`gatePermissions.${key}`, 'must be a non-blank permission id.');
    }
  }
  return merged;
};

/**
 * The paging policy in force, refusing anything that would unbound a request.
 *
 * Each number is checked for being a positive integer — `Number(env)` on an
 * unset variable is `NaN`, which compares false against every clamp in
 * `wire.ts` and would let `?pageSize=1000000` through as written — and
 * `defaultPageSize` may not exceed `maxPageSize`, which is the combination
 * that quietly serves a page larger than the ceiling the host declared to
 * every request that names no size at all.
 */
export function pagingOf(config: Pick<AuditServerConfig, 'pagination'>): AuditPagingPolicy {
  const merged = { ...DEFAULT_PAGINATION, ...config.pagination };
  for (const [key, value] of Object.entries(merged)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new AuditConfigError(
        `pagination.${key}`,
        `must be a positive integer; received ${String(value)}.`,
      );
    }
  }
  if (merged.defaultPageSize > merged.maxPageSize) {
    throw new AuditConfigError(
      'pagination.defaultPageSize',
      `may not exceed pagination.maxPageSize (${merged.maxPageSize}) — a request ` +
        'that names no size would otherwise be served more rows than the ceiling.',
    );
  }
  return merged;
}

/**
 * A set of Prisma model names, or a config error.
 *
 * The whitespace case is the silent one, and the same shape the vocabulary
 * refuses: `'Product '` matches no model, so the stamp or the guard a host
 * believes it declared simply never fires — a tracked model whose `created_by`
 * stays NULL looks exactly like a system write, and an unguarded immutable
 * table looks exactly like a guarded one until something deletes from it.
 */
export function modelNamesOf(path: string, declared: readonly string[] | undefined): string[] {
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) {
    throw new AuditConfigError(path, 'must be an array of Prisma model names.');
  }
  const names = new Set<string>();
  for (const name of declared as unknown[]) {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new AuditConfigError(path, 'every model name must be a non-blank string.');
    }
    if (name !== name.trim()) {
      throw new AuditConfigError(
        path,
        `"${name}" has surrounding whitespace — declare it as "${name.trim()}". ` +
          'A padded name matches no model, so the hook you declared never fires.',
      );
    }
    names.add(name);
  }
  return [...names];
}
