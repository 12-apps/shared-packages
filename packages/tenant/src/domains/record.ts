/**
 * A tenant's custom domain AS ONE THING: the rows of a root + `www` pair
 * folded into the one domain every reader answers with. Storage (the host's)
 * keeps a row per name, so the TLS ask and the host-to-tenant lookup stay one
 * indexed probe by hostname; nothing outside the host's repository ever sees
 * the `www.` row on its own.
 *
 * Pure: rows in, records out. The host reads the rows (its own table, its own
 * column names) and maps them to {@link TenantDomainRow}.
 */

/** Statuses a domain row can hold. */
export type TenantDomainStatus = 'PENDING' | 'VERIFIED' | 'ACTIVE' | 'DISABLED' | 'FAILED';

/** One stored row, as the host reads it. */
export interface TenantDomainRow {
  id: string;
  hostname: string;
  status: string;
  verificationToken: string;
  verifiedAt: Date | null;
  dnsPointsHere: boolean | null;
  createdAt: Date;
  /** The root row's id on a `www.` row; null on a root (or a lone subdomain). */
  pairRootId: string | null;
  /** On a root row: the `www.` name is the principal address. */
  wwwPrincipal: boolean;
  archivedAt: Date | null;
  archivedByUserId: string | null;
}

/** One name a domain answers on. */
export interface TenantDomainName {
  hostname: string;
  /** Did this name resolve to this deploy at the last check? `null` is unknown. */
  dnsPointsHere: boolean | null;
  /** The address the tenant answers on; the other name redirects to it. */
  principal: boolean;
}

/** A domain as everything outside the host's repository reads it. */
export interface TenantDomainRecord {
  /** The ROOT row's id: the only id a domain is ever addressed by. */
  id: string;
  /** The claimed name: the root of a pair, or the one subdomain. */
  hostname: string;
  /** The pair's `www.` name, or null for a subdomain claim. */
  wwwHostname: string | null;
  /** Which of the pair is the principal address; always `root` for a subdomain. */
  principal: 'root' | 'www';
  status: TenantDomainStatus;
  verificationToken: string;
  verifiedAt: Date | null;
  /**
   * Did the domain resolve to this deploy at the last check? For a pair: `false`
   * when either name points elsewhere, `true` when both point here, else unknown.
   */
  dnsPointsHere: boolean | null;
  /** Each name, root first. */
  names: TenantDomainName[];
  createdAt: Date;
  archivedAt: Date | null;
  archivedByUserId: string | null;
  /** Each name's own row id: writes address a row, never a hostname (an archived row may share it). */
  rowIds: Readonly<Record<string, string>>;
}

/** A pair's pointing answer: a known `false` on either name wins, then a known `true` on both. */
function combinedPointing(values: readonly (boolean | null)[]): boolean | null {
  if (values.some((value) => value === false)) return false;
  return values.every((value) => value === true) ? true : null;
}

/** Fold one root row and its `www.` row (if any) into the domain. */
export function domainOf(root: TenantDomainRow, www?: TenantDomainRow): TenantDomainRecord {
  const principal = www !== undefined && root.wwwPrincipal ? 'www' : 'root';
  const names: TenantDomainName[] = [
    { hostname: root.hostname, dnsPointsHere: root.dnsPointsHere, principal: principal === 'root' },
    ...(www === undefined ? [] : [{ hostname: www.hostname, dnsPointsHere: www.dnsPointsHere, principal: principal === 'www' }]),
  ];
  return {
    id: root.id,
    hostname: root.hostname,
    wwwHostname: www?.hostname ?? null,
    principal,
    status: root.status as TenantDomainStatus,
    verificationToken: root.verificationToken,
    verifiedAt: root.verifiedAt,
    dnsPointsHere: combinedPointing(names.map((name) => name.dnsPointsHere)),
    names,
    createdAt: root.createdAt,
    archivedAt: root.archivedAt,
    archivedByUserId: root.archivedByUserId,
    rowIds: { [root.hostname]: root.id, ...(www === undefined ? {} : { [www.hostname]: www.id }) },
  };
}

/** Group rows (any order) into domains, keeping the roots' order. */
export function domainsOf(rows: readonly TenantDomainRow[]): TenantDomainRecord[] {
  const wwwOf = new Map(
    rows.flatMap((row) => (row.pairRootId === null ? [] : [[row.pairRootId, row] as const])),
  );
  return rows.filter((row) => row.pairRootId === null).map((root) => domainOf(root, wwwOf.get(root.id)));
}

/** The principal hostname of a domain. */
export function principalHostOf(domain: TenantDomainRecord): string {
  return domain.principal === 'www' && domain.wwwHostname !== null ? domain.wwwHostname : domain.hostname;
}

/**
 * The tenant's canonical host: a pair answers at its PRINCIPAL name, and only
 * while that name is not known to point elsewhere; the oldest such domain wins,
 * so the answer is stable when a second domain is added. Give it the tenant's
 * ACTIVE rows, oldest first. The plan gate is the caller's.
 */
export function canonicalHostOf(activeRowsOldestFirst: readonly TenantDomainRow[]): string | null {
  for (const domain of domainsOf(activeRowsOldestFirst)) {
    const principal = principalHostOf(domain);
    if (domain.names.find((name) => name.hostname === principal)?.dnsPointsHere !== false) return principal;
  }
  return null;
}

/**
 * Where a request on `hostname` must be sent instead: a pair's other name
 * redirects to its principal, or null to serve it as it is. Give it the pair's
 * rows (the root and its `www.`). Only an ACTIVE pair redirects, and only to a
 * principal not known to point elsewhere: the same condition the canonical
 * host holds, so neither ever bounces a visitor to a name that does not answer.
 */
export function pairRedirectOf(rows: readonly TenantDomainRow[], hostname: string): string | null {
  const root = rows.find((row) => row.pairRootId === null);
  if (root === undefined) return null;
  const domain = domainOf(root, rows.find((row) => row.pairRootId === root.id));
  const principal = principalHostOf(domain);
  if (principal === hostname || domain.wwwHostname === null) return null;
  const target = domain.names.find((name) => name.hostname === principal);
  if (target?.dnsPointsHere === false || domain.status !== 'ACTIVE') return null;
  return principal;
}
