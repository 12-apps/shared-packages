/**
 * The server half of custom domains: the ports, the DNS checks through the
 * host's resolver, the engine and the TLS ask. Runtime-free (no Node module):
 * exported from `@12-apps/tenant` and `@12-apps/tenant/server`.
 */
import { TenantConfigError } from '../validate';
import { createDnsChecks, validateDnsChecksConfig, type TenantDomainDnsChecks, type TenantDomainDnsChecksConfig } from './checks';
import { createTenantDomains, validateDomainPorts, type TenantDomains } from './engine';
import type { TenantDomainPort, TenantDomainQuota } from './port';
import { createTlsAsk, validateTlsConfig, type TenantDomainTlsAnswer, type TenantDomainTlsConfig } from './tls';

export {
  createDnsChecks,
  type TenantDomainDnsChecks,
  type TenantDomainDnsChecksConfig,
} from './checks';
export {
  createTenantDomains,
  type TenantDomainAnswer,
  type TenantDomainContext,
  type TenantDomainOutcome,
  type TenantDomainResult,
  type TenantDomains,
  type TenantDomainsConfig,
} from './engine';
export {
  TENANT_DOMAIN_PORT_METHODS,
  TENANT_DOMAIN_QUOTA_METHODS,
  TENANT_DOMAIN_RESOLVER_METHODS,
  type TenantDomainPort,
  type TenantDomainQuota,
  type TenantDomainResolver,
} from './port';
export { createTlsAsk, type TenantDomainTls, type TenantDomainTlsAnswer, type TenantDomainTlsConfig } from './tls';

/** Custom domains' whole config, as `createApiTenant` takes it (`domains`). Every member required. */
export interface TenantDomainsServerConfig<Tx = unknown> {
  port: TenantDomainPort<Tx>;
  quota: TenantDomainQuota<Tx>;
  dns: TenantDomainDnsChecksConfig;
  tls: TenantDomainTlsConfig;
}

/** `tenant.domains`: the engine's `run`, the DNS checks, and the TLS ask. */
export interface ApiTenantDomains extends TenantDomains {
  dns: TenantDomainDnsChecks;
  ask(hostname: string): Promise<TenantDomainTlsAnswer>;
}

/**
 * Custom domains, when the host opts in: every member named under `domains.`.
 * Left out (`undefined`), there is nothing to check.
 */
export function validateDomains(value: unknown): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TenantConfigError('domains', 'must be the domains config object ({ port, quota, dns, tls }), or be left out');
  }
  const bag = value as Record<string, unknown>;
  validateDomainPorts(bag, 'domains.');
  validateDnsChecksConfig(bag.dns, 'domains.dns.');
  validateTlsConfig(bag.tls, 'domains.tls.');
}

/** Build `tenant.domains` from a validated config. */
export function createApiTenantDomains<Tx>(config: TenantDomainsServerConfig<Tx>): ApiTenantDomains {
  const dns = createDnsChecks(config.dns);
  const engine = createTenantDomains({ port: config.port, quota: config.quota, dns });
  const tls = createTlsAsk(config.tls);
  return { run: engine.run, dns, ask: tls.ask };
}
