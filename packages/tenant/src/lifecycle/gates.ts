/**
 * The two gates a closing or closed tenant puts in front of an API.
 *
 * - **Admin** (`<admin.prefix>/<slug>/…`): an open tenant passes; a CLOSED one
 *   is refused (`closed`); a CLOSING one admits only whoever holds the close
 *   permission (`holdsClose`), who reads everything and writes only through
 *   `admin.closingWrites`, the rest `readOnly`; everyone else `closing`.
 *   A request with nobody signed in passes: the route's own guard answers it.
 * - **Public** (`<public.prefix>/<family>/<slug>/…`): a write (and, for a
 *   `readsToo` family, a read) naming a closing or closed tenant is refused
 *   `gone`. A family's `fixedWords` are routes of its own, never asked as a
 *   slug; after a word in `slugAfter` the NEXT segment is the slug.
 *
 * The status rides the host's `lookup` (its kept slug lookup): an open tenant
 * pays whatever that lookup costs and nothing more, and a fixed word pays
 * nothing. A lookup that throws passes the request on: the route's own lookup
 * fails the same way. The path is read as a router reads it (`decodeURI`), so
 * an escaped segment is no way around; the slug is decoded.
 */
import type { TenantCopyPack, TenantCoreConfig } from '../config';
import type { DeepReadonly } from '../core';
import { isTenantGone } from './pure';
import { TENANT_REFUSAL_STATUS, refusalSentence, type GateRefusal, type TenantLifecycleRefusalKind } from './refusal';
import { validateGates } from './validate';

export interface TenantPublicFamily {
  /** Refuse reads too (a menu that must not be served), not only writes. */
  readsToo: boolean;
  /** Second segments that are routes of the family, never a slug. */
  fixedWords: readonly string[];
  /** Second segments after which the THIRD segment is the slug. */
  slugAfter: readonly string[];
}

export interface TenantGatesConfig {
  admin: { prefix: string; closingWrites: readonly string[] };
  public: { prefix: string; families: Readonly<Record<string, TenantPublicFamily>> };
  /** The host's kept slug lookup: the tenant's id and status, or null. */
  lookup(slug: string): Promise<{ id: string; status: string } | null>;
  /** Whether the signed-in actor holds the close permission; null when nobody is signed in. Fail closed. */
  holdsClose(request: Request, tenantId: string): Promise<boolean | null>;
  /** The current request's locale (null: the default pack). */
  locale(): string | null;
}

export interface TenantGates {
  /** The refusal an admin request meets, or null when it passes. */
  adminRefusal(request: Request): Promise<GateRefusal | null>;
  /** The refusal a public request meets, or null when it passes. */
  publicRefusal(request: Request): Promise<GateRefusal | null>;
  /** The slug a public path names, or null for a path that names none (or a read the family lets through). */
  publicSlugOf(path: string, method: string): string | null;
  /** The admin decision for a tenant of `status`; `holds` is asked only while it is closing. */
  adminDecision(
    status: string,
    request: { method: string; rest: string },
    holds: () => Promise<boolean | null>,
  ): Promise<GateRefusal | null>;
  /** The admin and public prefixes and families, as validated: what a mount reads. */
  config: DeepReadonly<Pick<TenantGatesConfig, 'admin' | 'public'>>;
}

/** Methods that read: everything else writes. */
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** The path as the router reads it (an escaped segment decoded). */
function routedPath(pathname: string): string {
  try {
    return decodeURI(pathname);
  } catch {
    return pathname;
  }
}

/** The decoded slug, or null for a malformed escape: the route answers that request itself. */
function decodedSlug(slug: string): string | null {
  try {
    return decodeURIComponent(slug);
  } catch {
    return null;
  }
}

export function createTenantGates(
  tenant: { config: DeepReadonly<TenantCoreConfig>; copyFor(locale: string | null | undefined): TenantCopyPack },
  config: TenantGatesConfig,
): TenantGates {
  validateGates(config);
  const { statuses, ids } = tenant.config;
  const adminRoute = new RegExp(`^${escaped(config.admin.prefix)}/([^/]+)(/.*)?$`, 'u');
  const closingWrites = new Set(config.admin.closingWrites);
  const families = new Map(
    Object.entries(config.public.families).map(([name, family]) => [
      name,
      { readsToo: family.readsToo, fixed: new Set(family.fixedWords), after: new Set(family.slugAfter) },
    ]),
  );
  const publicDepth = config.public.prefix.split('/').length - 1;

  const refusal = (kind: TenantLifecycleRefusalKind): GateRefusal => ({
    kind,
    status: TENANT_REFUSAL_STATUS[kind],
    code: ids.refusals[kind],
    message: refusalSentence(tenant.copyFor(config.locale()), kind),
  });

  const adminDecision: TenantGates['adminDecision'] = async (status, request, holds) => {
    if (!isTenantGone(statuses, status)) return null;
    if (status === statuses.closed) return refusal('closed');
    const holder = await holds();
    if (holder === null) return null;
    if (!holder) return refusal('closing');
    if (READS.has(request.method.toUpperCase()) || closingWrites.has(request.rest)) return null;
    return refusal('readOnly');
  };

  /** The family's rule for a path under the public prefix, and the segments after the family. */
  const ruleOf = (path: string, method: string) => {
    if (!path.startsWith(`${config.public.prefix}/`)) return null;
    const [family = '', second = '', third = ''] = path.split('/').slice(publicDepth + 1);
    const rule = families.get(family);
    if (rule === undefined || (READS.has(method.toUpperCase()) && !rule.readsToo)) return null;
    return { rule, second, third };
  };

  const publicSlugOf: TenantGates['publicSlugOf'] = (path, method) => {
    const found = ruleOf(path, method);
    if (found === null) return null;
    const { rule, second, third } = found;
    if (rule.after.has(second)) return third || null;
    return rule.fixed.has(second) ? null : second || null;
  };

  const lookup = (slug: string) => config.lookup(slug).catch(() => null);

  return {
    config: { admin: config.admin, public: config.public } as TenantGates['config'],
    adminDecision,
    publicSlugOf,
    adminRefusal: async (request) => {
      const match = adminRoute.exec(routedPath(new URL(request.url).pathname));
      const slug = match?.[1] === undefined ? null : decodedSlug(match[1]);
      const found = slug === null ? null : await lookup(slug);
      if (found === null || !isTenantGone(statuses, found.status)) return null;
      return adminDecision(found.status, { method: request.method, rest: match?.[2] ?? '' }, () =>
        config.holdsClose(request, found.id),
      );
    },
    publicRefusal: async (request) => {
      const raw = publicSlugOf(routedPath(new URL(request.url).pathname), request.method);
      const slug = raw === null ? null : decodedSlug(raw);
      const found = slug === null ? null : await lookup(slug);
      return found !== null && isTenantGone(statuses, found.status) ? refusal('gone') : null;
    },
  };
}
