import { describe, expect, it } from 'vitest';

import { createDnsChecks } from '../domains/checks';
import { createTenantDomains } from '../domains/engine';
import { TENANT_DOMAIN_PORT_METHODS, TENANT_DOMAIN_QUOTA_METHODS } from '../domains/port';
import { createApiTenant } from '../server';
import { TenantConfigError } from '../validate';
import { serverConfig } from './fixtures';
import { memoryPort, memoryQuota } from './domains-fixtures';

function domainsConfig() {
  const memory = memoryPort();
  return {
    port: memory.port as unknown as Record<string, unknown>,
    quota: memoryQuota(memory.table).quota as unknown as Record<string, unknown>,
    dns: {
      resolver: { txt: async () => [], ipv4: async () => [], ipv6: async () => [] } as Record<string, unknown>,
      dnsTargets: (() => []) as unknown,
      recordPrefix: '_check' as unknown,
    },
    tls: { servable: async () => null, entitled: async () => true } as Record<string, unknown>,
  };
}

function keyOf(build: () => unknown): string {
  try {
    build();
  } catch (error) {
    expect(error).toBeInstanceOf(TenantConfigError);
    return (error as TenantConfigError).key;
  }
  throw new Error('expected a TenantConfigError');
}

const boot = (domains: unknown) => () =>
  createApiTenant({ ...serverConfig(), domains } as unknown as Parameters<typeof createApiTenant>[0]);

describe('custom domains config', () => {
  it('a host without domains boots with no tenant.domains', () => {
    const tenant = createApiTenant(serverConfig());
    expect(tenant.domains).toBeUndefined();
  });

  it('a host with every member gets run, dns and ask', async () => {
    const tenant = boot(domainsConfig())();
    expect(typeof tenant.domains?.run).toBe('function');
    await expect(tenant.domains?.ask('x.com')).resolves.toBe('unknown');
    expect(tenant.domains?.dns.targets()).toEqual([]);
  });

  it('names domains itself when it is not an object', () => {
    expect(keyOf(boot(null))).toBe('domains');
    expect(keyOf(boot('yes'))).toBe('domains');
  });

  it.each(TENANT_DOMAIN_PORT_METHODS)('names domains.port.%s', (method) => {
    const domains = domainsConfig();
    delete domains.port[method];
    expect(keyOf(boot(domains))).toBe(`domains.port.${method}`);
  });

  it.each(TENANT_DOMAIN_QUOTA_METHODS)('names domains.quota.%s', (method) => {
    const domains = domainsConfig();
    domains.quota[method] = 'not a function';
    expect(keyOf(boot(domains))).toBe(`domains.quota.${method}`);
  });

  it.each(['txt', 'ipv4', 'ipv6'])('names domains.dns.resolver.%s', (method) => {
    const domains = domainsConfig();
    delete domains.dns.resolver[method];
    expect(keyOf(boot(domains))).toBe(`domains.dns.resolver.${method}`);
  });

  it('names the targets, the prefix and the TLS members', () => {
    const noTargets = domainsConfig();
    noTargets.dns.dnsTargets = ['1.2.3.4'];
    expect(keyOf(boot(noTargets))).toBe('domains.dns.dnsTargets');
    const badPrefix = domainsConfig();
    badPrefix.dns.recordPrefix = 'has.dot';
    expect(keyOf(boot(badPrefix))).toBe('domains.dns.recordPrefix');
    const noPrefix = domainsConfig();
    noPrefix.dns.recordPrefix = undefined;
    expect(keyOf(boot(noPrefix))).toBe('domains.dns.recordPrefix');
    for (const member of ['servable', 'entitled']) {
      const noTls = domainsConfig();
      delete noTls.tls[member];
      expect(keyOf(boot(noTls))).toBe(`domains.tls.${member}`);
    }
  });

  it('the standalone factories check their own piece', () => {
    const domains = domainsConfig();
    delete domains.quota.used;
    expect(
      keyOf(() =>
        createTenantDomains({ port: domains.port, quota: domains.quota, dns: {} } as unknown as Parameters<typeof createTenantDomains>[0]),
      ),
    ).toBe('quota.used');
    expect(
      keyOf(() => createDnsChecks({ resolver: { txt: async () => [] }, dnsTargets: () => [], recordPrefix: '_x' } as never)),
    ).toBe('resolver.ipv4');
  });
});
