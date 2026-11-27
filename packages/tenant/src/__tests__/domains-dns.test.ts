import { describe, expect, it } from 'vitest';

import { createDnsChecks } from '../domains/checks';
import {
  createDomainDns,
  dnsZoneOf,
  isZoneApex,
  pointingRecordType,
  relativeDnsName,
  wwwCompanionOf,
} from '../domains/dns-names';
import { draftHostname, hostnameOrNull } from '../domains/hostname';
import type { TenantDomainResolver } from '../domains/port';
import { TenantConfigError } from '../validate';

const prefixed = () => createDomainDns({ recordPrefix: '_acme-check' });
const domain = (hostname: string, www: string | null = wwwCompanionOf(hostname)) => ({
  hostname,
  wwwHostname: www,
  verificationToken: 'tok-1',
});

describe('hostnames', () => {
  it('reduces what a person pastes to the stored name, or null', () => {
    expect(hostnameOrNull('  HTTPS://Acme.COM.br/menu ')).toBe('acme.com.br');
    expect(hostnameOrNull('acme.com.')).toBe('acme.com');
    expect(hostnameOrNull('acme')).toBeNull();
    expect(hostnameOrNull('*.acme.com')).toBeNull();
    expect(hostnameOrNull('acme.com:8080')).toBeNull();
    expect(hostnameOrNull('-acme.com')).toBeNull();
  });

  it('previews a draft with the looser grammar', () => {
    expect(draftHostname('https://Acme.com/x')).toBe('acme.com');
    expect(draftHostname('acme')).toBeNull();
  });

  it('cuts the path at the first slash, a run of slashes included', () => {
    expect(hostnameOrNull('acme.com/a/b/c')).toBe('acme.com');
    expect(hostnameOrNull('acme.com.//x')).toBe('acme.com');
    const slashes = `/${'/'.repeat(100_000)}x`;
    expect(hostnameOrNull(slashes)).toBeNull();
    expect(draftHostname(`acme.com${slashes}`)).toBe('acme.com');
  });
});

describe('zones and pairs', () => {
  it('pairs a zone apex under a .br second level, a one-label suffix and co.uk', () => {
    expect(wwwCompanionOf('acme.com.br')).toBe('www.acme.com.br');
    expect(wwwCompanionOf('acme.rec.br')).toBe('www.acme.rec.br');
    expect(wwwCompanionOf('acme.com')).toBe('www.acme.com');
    expect(wwwCompanionOf('acme.co.uk')).toBe('www.acme.co.uk');
  });

  it('never pairs a subdomain, www. itself included', () => {
    expect(wwwCompanionOf('menu.acme.com.br')).toBeNull();
    expect(wwwCompanionOf('www.acme.com.br')).toBeNull();
    expect(wwwCompanionOf('shop.acme.com')).toBeNull();
    expect(isZoneApex('shop.acme.com')).toBe(false);
    expect(dnsZoneOf('shop.acme.com.br')).toBe('acme.com.br');
  });

  it('names a record relative to the zone, @ for the zone itself', () => {
    expect(relativeDnsName('acme.com.br', 'acme.com.br')).toBe('@');
    expect(relativeDnsName('_x.shop.acme.com.br', 'shop.acme.com.br')).toBe('_x.shop');
    expect(relativeDnsName('', 'acme.com')).toBe('');
  });

  it("tells a target's record type from its shape", () => {
    expect(pointingRecordType('203.0.113.10')).toBe('A');
    expect(pointingRecordType('2001:db8::1')).toBe('AAAA');
    expect(pointingRecordType('edge.example.net')).toBe('CNAME');
  });
});

describe('createDomainDns', () => {
  it('a pair: ONE TXT at the root under the host prefix, and an A record for @ and for www', () => {
    expect(prefixed().recordsOf(domain('acme.com.br'), ['203.0.113.10'])).toEqual({
      zone: 'acme.com.br',
      kind: 'apex',
      hostnames: ['acme.com.br', 'www.acme.com.br'],
      verification: { type: 'TXT', name: '_acme-check', fqdn: '_acme-check.acme.com.br', values: ['tok-1'] },
      pointing: [
        { type: 'A', name: '@', fqdn: 'acme.com.br', values: ['203.0.113.10'] },
        { type: 'A', name: 'www', fqdn: 'www.acme.com.br', values: ['203.0.113.10'] },
      ],
      replaceRecordsNamed: ['@', 'www'],
    });
  });

  it('a subdomain: its own label; a dual-stacked deploy: an A and an AAAA, in order', () => {
    const records = prefixed().recordsOf(domain('menu.acme.com.br'), ['203.0.113.10', '2001:db8::1']);
    expect(records.kind).toBe('subdomain');
    expect(records.verification.name).toBe('_acme-check.menu');
    expect(records.pointing.map((record) => `${record.type} ${record.name} ${record.values.join(',')}`)).toEqual([
      'A menu 203.0.113.10',
      'AAAA menu 2001:db8::1',
    ]);
  });

  it('no address known: no pointing records, the TXT still', () => {
    const records = prefixed().recordsOf(domain('acme.com'), []);
    expect(records.pointing).toEqual([]);
    expect(prefixed().verificationRecordName('acme.com')).toBe('_acme-check.acme.com');
  });

  it('refuses a prefix that is not one DNS label, naming the key', () => {
    for (const recordPrefix of ['', 'two.labels', '_Upper', 'trailing-', undefined]) {
      expect(() => createDomainDns({ recordPrefix } as { recordPrefix: string })).toThrow(TenantConfigError);
    }
    try {
      createDomainDns({ recordPrefix: 'a.b' });
    } catch (error) {
      expect((error as TenantConfigError).key).toBe('recordPrefix');
    }
  });
});

function resolver(overrides: Partial<TenantDomainResolver> = {}): TenantDomainResolver {
  return {
    txt: async () => [],
    ipv4: async () => [],
    ipv6: async () => [],
    ...overrides,
  };
}

describe('createDnsChecks', () => {
  const checks = (r: TenantDomainResolver, targets: () => string[] = () => ['203.0.113.10']) =>
    createDnsChecks({ resolver: r, dnsTargets: targets, recordPrefix: '_acme-check' });

  it('finds the token at the prefixed name, chunks joined and trimmed', async () => {
    const asked: string[] = [];
    const owned = checks(
      resolver({
        txt: async (name) => {
          asked.push(name);
          return [['other'], ['tok', '-1 ']];
        },
      }),
    );
    await expect(owned.ownsRecord('acme.com', 'tok-1')).resolves.toBe(true);
    await expect(owned.ownsRecord('acme.com', 'tok-2')).resolves.toBe(false);
    expect(asked[0]).toBe('_acme-check.acme.com');
  });

  it('never throws: a failed TXT lookup is unverified', async () => {
    const failing = checks(resolver({ txt: async () => Promise.reject(new Error('ENOTFOUND')) }));
    await expect(failing.ownsRecord('acme.com', 'tok-1')).resolves.toBe(false);
  });

  it('pointing is tri-state: here, elsewhere, unknown', async () => {
    await expect(checks(resolver({ ipv4: async () => ['203.0.113.10'] })).pointsHere('acme.com')).resolves.toBe(true);
    await expect(checks(resolver({ ipv4: async () => ['198.51.100.1'] })).pointsHere('acme.com')).resolves.toBe(false);
    await expect(checks(resolver()).pointsHere('acme.com')).resolves.toBeNull();
    const failing = resolver({
      ipv4: async () => Promise.reject(new Error('SERVFAIL')),
      ipv6: async () => Promise.reject(new Error('SERVFAIL')),
    });
    await expect(checks(failing).pointsHere('acme.com')).resolves.toBeNull();
  });

  it('one family failing keeps the other answer', async () => {
    const r = resolver({ ipv4: async () => Promise.reject(new Error('x')), ipv6: async () => ['2001:db8::1'] });
    await expect(checks(r, () => ['2001:DB8:0:0::1']).pointsHere('acme.com')).resolves.toBe(true);
  });

  it('reads the targets on every call: none means unknown, with no lookup', async () => {
    let asked = 0;
    const r = resolver({ ipv4: async () => (asked++, ['203.0.113.10']) });
    const answers = [[], ['203.0.113.10']];
    const reading = checks(r, () => answers.shift() ?? []);
    await expect(reading.pointsHere('acme.com')).resolves.toBeNull();
    expect(asked).toBe(0);
    expect(reading.targets()).toEqual(['203.0.113.10']);
  });

  it('a synchronous throw from the resolver is still an answer, never an error', async () => {
    const r = resolver({
      ipv4: () => {
        throw new Error('not mocked');
      },
      ipv6: async () => ['2001:db8::9'],
    });
    await expect(checks(r).pointsHere('acme.com')).resolves.toBe(false);
  });
});
