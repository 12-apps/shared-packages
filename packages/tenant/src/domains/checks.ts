/**
 * The two DNS questions about a custom domain, through the HOST's resolver.
 *
 * - **Ownership** (`ownsRecord`): the TXT record at `<prefix>.<hostname>`
 *   carries the token the host minted. It proves the claimant controls the
 *   zone, which is the only thing that makes serving the name, and asking a CA
 *   for a certificate on its behalf, legitimate. Pointing an A record at an IP
 *   needs no relationship with the IP's owner, so it proves nothing.
 * - **Pointing** (`pointsHere`): does the name resolve to this deploy? The
 *   failure it makes visible LOOKS LIKE SUCCESS: the TXT verifies, the domain
 *   goes ACTIVE, and the DNS still points somewhere else. So it is ADVISORY:
 *   it never gates verification, and a resolver failure is unknown (`null`),
 *   never "not pointed".
 *
 * Neither ever throws. The resolver is the host's so a host's tests can
 * replace it; nothing here imports a DNS module.
 */
import { TenantConfigError } from '../validate';
import { createDomainDns, validateRecordPrefix } from './dns-names';
import { TENANT_DOMAIN_RESOLVER_METHODS, type TenantDomainResolver } from './port';

export interface TenantDomainDnsChecksConfig {
  resolver: TenantDomainResolver;
  /** Where names must point: the deploy's public address(es). Read on EVERY call; empty = unknown. */
  dnsTargets: () => string[];
  /** The TXT record's label, one DNS label (`_verify`). */
  recordPrefix: string;
}

export interface TenantDomainDnsChecks {
  /** The deploy's targets, as `dnsTargets()` answers now. */
  targets(): string[];
  /** True when `token` is published at the verification record. Never throws. */
  ownsRecord(hostname: string, token: string): Promise<boolean>;
  /**
   * `true` an address of the name is one of ours; `false` it resolves, to
   * nothing of ours; `null` unknown (no target, a failed or empty lookup).
   */
  pointsHere(hostname: string): Promise<boolean | null>;
}

type Bag = Record<string, unknown>;
const isBag = (value: unknown): value is Bag => typeof value === 'object' && value !== null && !Array.isArray(value);

function requireFunction(bag: Bag, name: string, key: string): void {
  if (bag[name] === undefined || bag[name] === null) throw new TenantConfigError(key, 'is required and missing');
  if (typeof bag[name] !== 'function') throw new TenantConfigError(key, 'must be a function');
}

/** Check the checks' config; keys are named under `prefix` (`domains.dns.`). */
export function validateDnsChecksConfig(value: unknown, prefix: string): void {
  const where = prefix === '' ? 'dns' : prefix.replace(/\.$/, '');
  if (!isBag(value)) {
    throw new TenantConfigError(where, value === undefined || value === null ? 'is required and missing' : 'must be an object');
  }
  if (!isBag(value.resolver)) {
    throw new TenantConfigError(
      `${prefix}resolver`,
      value.resolver === undefined || value.resolver === null ? 'is required and missing' : 'must be an object',
    );
  }
  for (const method of TENANT_DOMAIN_RESOLVER_METHODS) {
    requireFunction(value.resolver, method, `${prefix}resolver.${method}`);
  }
  requireFunction(value, 'dnsTargets', `${prefix}dnsTargets`);
  validateRecordPrefix(value.recordPrefix, `${prefix}recordPrefix`);
}

/**
 * One spelling per address. The resolver answers IPv6 compressed and lower
 * case (`2001:db8::1`), but a target is hand-typed and may arrive as
 * `2001:DB8:0:0::1`: the same address, which a plain compare would call "not
 * pointed here". `URL` canonicalises a bracketed IPv6 host per RFC 5952;
 * anything else (IPv4, a hostname) is only lower-cased.
 */
function canonicalAddress(address: string): string {
  const bare = address.trim().toLowerCase();
  if (!bare.includes(':')) return bare;
  try {
    return new URL(`http://[${bare.replace(/^\[|\]$/g, '')}]/`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return bare;
  }
}

export function createDnsChecks(config: TenantDomainDnsChecksConfig): TenantDomainDnsChecks {
  validateDnsChecksConfig(config, '');
  const { resolver, dnsTargets } = config;
  const records = createDomainDns({ recordPrefix: config.recordPrefix });

  /**
   * Every A and AAAA record for the name. Both families are asked, and either
   * failing alone must not erase the other's answer: `allSettled`, not `all`.
   */
  async function addressesOf(hostname: string): Promise<string[]> {
    const results = await Promise.allSettled([
      Promise.resolve().then(() => resolver.ipv4(hostname)),
      Promise.resolve().then(() => resolver.ipv6(hostname)),
    ]);
    return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  }

  return {
    targets: () => dnsTargets(),
    ownsRecord: async (hostname, token) => {
      try {
        // TXT values may be split at 255 bytes: each record's chunks are joined before comparing.
        const found = await resolver.txt(records.verificationRecordName(hostname));
        return found.some((chunks) => chunks.join('').trim() === token);
      } catch {
        // NXDOMAIN, no record, a timeout: unverified, never an error. Retrying is the answer to both.
        return false;
      }
    },
    pointsHere: async (hostname) => {
      const targets = dnsTargets();
      if (targets.length === 0) return null;
      const addresses = await addressesOf(hostname);
      if (addresses.length === 0) return null;
      const ours = new Set(targets.map(canonicalAddress));
      return addresses.some((address) => ours.has(canonicalAddress(address)));
    },
  };
}
