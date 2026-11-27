/**
 * The ports a host gives custom domains. The domain table is the HOST's: the
 * package maps no table and names no column, so every read and write goes
 * through {@link TenantDomainPort}, and the plan's quota through
 * {@link TenantDomainQuota}. Both are required, every member.
 */
import type { TenantDomainRecord, TenantDomainRow } from './record';

/**
 * The host's domain rows. Statement budget (ADOPTING.md, "Custom domains"):
 * `rows` and `holders` are ONE read each; a member that adds a read is a defect.
 */
export interface TenantDomainPort<Tx = unknown> {
  /** EVERY row of the tenant, removed ones included, newest first (`createdAt` desc, `hostname` asc). One read. */
  rows(tenantId: string, tx?: Tx): Promise<TenantDomainRow[]>;
  /** The live rows of ANY tenant holding any of `hostnames`. One read. */
  holders(hostnames: readonly string[], tx?: Tx): Promise<{ hostname: string; tenantId: string }[]>;
  /** Run `work` in ONE transaction at SERIALIZABLE isolation. */
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  /**
   * What a thrown error means: `'retry'` a serializable transaction that lost
   * to a concurrent one (nothing was written), `'taken'` a unique-index
   * violation on a hostname (a race claimed it first), `null` anything else,
   * which the engine rethrows.
   */
  failure(error: unknown): 'retry' | 'taken' | null;
  /**
   * Write a claim's rows: the name, and for a zone apex its `www.` too (one
   * domain, ONE token, which the host mints and which must be unguessable).
   */
  claim(tx: Tx, tenantId: string, hostname: string, principal: 'root' | 'www'): Promise<TenantDomainRecord>;
  /** Make `principal` the pair's principal address. */
  setPrincipal(tx: Tx, tenantId: string, id: string, principal: 'root' | 'www'): Promise<void>;
  /**
   * Record a check on every name of the domain, by each name's row id: verified
   * moves the rows to ACTIVE, else FAILED; a `null` pointing answer leaves the
   * stored one as it is.
   */
  recordCheck(
    tx: Tx,
    tenantId: string,
    domain: TenantDomainRecord,
    outcome: { verified: boolean; pointsHere: Readonly<Record<string, boolean | null>> },
    at: Date,
  ): Promise<void>;
  /**
   * Remove the pair (root and `www.`): archived, AND made unservable, so a
   * release that cannot read the archive column (a rollback) still never serves it.
   */
  archive(tx: Tx, tenantId: string, id: string, at: Date, by: string | null): Promise<void>;
  /** Bring the pair back, unverified: ownership is proven again with the same token. */
  restore(tx: Tx, tenantId: string, id: string): Promise<void>;
  /** One audit line per removal and restore, in the host's own ids and words. */
  audit(
    tx: Tx,
    line: { act: 'archive' | 'restore'; tenantId: string; domain: TenantDomainRecord; reason: string | null; via: string },
  ): Promise<void>;
}

export const TENANT_DOMAIN_PORT_METHODS = [
  'rows',
  'holders',
  'transaction',
  'failure',
  'claim',
  'setPrincipal',
  'recordCheck',
  'archive',
  'restore',
  'audit',
] as const satisfies readonly (keyof TenantDomainPort)[];

/**
 * The host's plan for custom domains. `via` is whatever the host put on the
 * context (where the call came from); the package never reads it, so a host
 * that answers one caller with its own refusal (a thrown platform error) and
 * another with a problem decides that here.
 */
export interface TenantDomainQuota<Tx = unknown> {
  /** Whether a `verify` may run at all. Asked only when the call has one; may throw the host's own refusal. */
  mayVerify(tenantId: string, via: string): Promise<boolean>;
  /**
   * Reserve `units` (> 0) new domains: the limit to re-check in the
   * transaction (`null` = unlimited), or which refusal. May throw the host's own.
   */
  reserve(
    tenantId: string,
    units: number,
    via: string,
  ): Promise<{ limit: number | null } | { refused: 'planRequired' | 'planLimit' }>;
  /** The tenant's domains counted against the plan, re-read on `tx`. */
  used(tenantId: string, tx: Tx): Promise<number>;
}

export const TENANT_DOMAIN_QUOTA_METHODS = ['mayVerify', 'reserve', 'used'] as const satisfies readonly (keyof TenantDomainQuota)[];

/** How the host resolves names. Its own, so its tests can replace it. */
export interface TenantDomainResolver {
  /** TXT records, each as its chunks. */
  txt(name: string): Promise<string[][]>;
  ipv4(name: string): Promise<string[]>;
  ipv6(name: string): Promise<string[]>;
}

export const TENANT_DOMAIN_RESOLVER_METHODS = ['txt', 'ipv4', 'ipv6'] as const satisfies readonly (keyof TenantDomainResolver)[];
