/**
 * The TLS "ask": a reverse proxy with on-demand certificates asks, BEFORE
 * ordering one for a name it has never seen, whether it may. It is the only
 * thing between "a name points at us" and "we asked a CA for a certificate",
 * so it is deny-by-default and two conditions must BOTH hold: the name is a
 * servable (verified) domain of a live tenant, and that tenant is entitled to
 * custom domains, so a downgrade stops renewal, not just serving.
 */
import { TenantConfigError } from '../validate';

export interface TenantDomainTlsConfig {
  /** The tenant that may be served on `hostname` (an ACTIVE domain of a live tenant), or null. */
  servable(hostname: string): Promise<{ tenantId: string } | null>;
  /** Whether the tenant's plan carries custom domains now. */
  entitled(tenantId: string): Promise<boolean>;
}

export type TenantDomainTlsAnswer = 'allow' | 'unknown' | 'unentitled';

export interface TenantDomainTls {
  /** `allow` only when both hold; `unknown` no servable domain; `unentitled` the plan does not carry it. */
  ask(hostname: string): Promise<TenantDomainTlsAnswer>;
}

function requireFunction(bag: Record<string, unknown>, member: string, key: string): void {
  if (bag[member] === undefined || bag[member] === null) throw new TenantConfigError(key, 'is required and missing');
  if (typeof bag[member] !== 'function') throw new TenantConfigError(key, 'must be a function');
}

/** Check the ask's config; keys are named under `prefix` (`domains.tls.`). */
export function validateTlsConfig(value: unknown, prefix: string): void {
  const where = prefix === '' ? 'tls' : prefix.replace(/\.$/, '');
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TenantConfigError(where, value === undefined || value === null ? 'is required and missing' : 'must be an object');
  }
  for (const member of ['servable', 'entitled'] as const) {
    requireFunction(value as Record<string, unknown>, member, `${prefix}${member}`);
  }
}

export function createTlsAsk(config: TenantDomainTlsConfig): TenantDomainTls {
  validateTlsConfig(config, '');
  return {
    ask: async (hostname) => {
      const servable = await config.servable(hostname.trim().toLowerCase());
      if (servable === null) return 'unknown';
      return (await config.entitled(servable.tenantId)) ? 'allow' : 'unentitled';
    },
  };
}
