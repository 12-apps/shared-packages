/**
 * THE DNS RECORDS a tenant publishes for its custom domain: one module for the
 * screen that shows them and the server read that hands them to an agent, so
 * what a person sees and what an agent is told cannot drift. Constants and
 * pure functions only: no copy, no React, no Node, so a browser bundle and a
 * server import the same file.
 *
 * The NAME a person types into their DNS provider is RELATIVE to the zone.
 * Providers do not ask for a fully qualified name: they show a host-name field
 * with the zone already printed after it, so pasting the full
 * `_verify.acme.com.br` there creates `_verify.acme.com.br.acme.com.br`, which
 * never verifies. They want the part BEFORE the zone, and `@` (or nothing) for
 * the zone itself.
 *
 * Finding the zone needs the public suffix: `acme.com.br` is a zone (`com.br`
 * is the suffix) while `shop.acme.com` is a subdomain of `acme.com`. The full
 * Public Suffix List is a dependency for one card, so this is a deliberate
 * heuristic: every second level the list has under `.br`, plus the common
 * ones under other two-letter country TLDs (`co.uk` and its kind). A name it
 * gets wrong still has its full form beside it (`fqdn`), so a miss costs a
 * read, not a dead domain.
 *
 * THE PAIR. A zone apex is claimed with its `www.` as ONE domain: one TXT
 * record at the root proves both, and BOTH names point here. A subdomain stays
 * one name.
 *
 * The TXT record's label (the prefix) is the host's: `createDomainDns` takes it
 * as config and refuses anything that is not one DNS label.
 */
import { TenantConfigError } from '../validate';

/** Second-level labels that, under a two-letter TLD other than `.br`, are part of the suffix. */
const SECOND_LEVEL_SUFFIXES = new Set(['com', 'net', 'org', 'edu', 'gov', 'co', 'ac', 'ltd', 'plc']);

/**
 * Every second level under `.br` (the Public Suffix List's `br` section: the
 * categories, the states and the cities). A miss here names the A record
 * wrongly: `acme.rec.br` read as the subdomain `acme` of `rec.br`.
 */
const BR_SECOND_LEVELS = new Set([
  '9guacu', 'abc', 'adm', 'adv', 'agr', 'aju', 'am', 'anani', 'aparecida', 'app', 'arq', 'art',
  'ato', 'b', 'barueri', 'belem', 'bhz', 'bib', 'bio', 'blog', 'bmd', 'boavista', 'bsb',
  'campinagrande', 'campinas', 'caxias', 'cim', 'cng', 'cnt', 'com', 'contagem', 'coop', 'coz',
  'cri', 'cuiaba', 'curitiba', 'def', 'des', 'det', 'dev', 'ecn', 'eco', 'edu', 'emp', 'enf',
  'eng', 'esp', 'etc', 'eti', 'far', 'feira', 'flog', 'floripa', 'fm', 'fnd', 'fortal', 'fot',
  'foz', 'fst', 'g12', 'geo', 'ggf', 'goiania', 'gov', 'gru', 'imb', 'ind', 'inf', 'jab', 'jampa',
  'jdf', 'joinville', 'jor', 'jus', 'leg', 'leilao', 'lel', 'log', 'londrina', 'macapa', 'maceio',
  'manaus', 'maringa', 'mat', 'med', 'mil', 'morena', 'mp', 'mus', 'natal', 'net', 'niteroi',
  'nom', 'not', 'ntr', 'odo', 'ong', 'org', 'osasco', 'palmas', 'poa', 'ppg', 'pro', 'psc', 'psi',
  'pvh', 'qsl', 'radio', 'rec', 'recife', 'rep', 'ribeirao', 'rio', 'riobranco', 'riopreto',
  'salvador', 'sampa', 'santamaria', 'santoandre', 'saobernardo', 'saogonca', 'seg', 'sjc', 'slg',
  'slz', 'sorocaba', 'srv', 'taxi', 'tc', 'tec', 'teo', 'the', 'tmp', 'trd', 'tur', 'tv', 'udi',
  'vet', 'vix', 'vlog', 'wiki', 'zlg', 'ac', 'al', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mg',
  'ms', 'mt', 'pa', 'pb', 'pe', 'pi', 'pr', 'rj', 'rn', 'ro', 'rr', 'rs', 'sc', 'se', 'sp', 'to',
]);

/** How many trailing labels of `labels` are the public suffix. */
function suffixLength(labels: readonly string[]): number {
  if (labels.length < 3) return 1;
  const tld = labels[labels.length - 1] ?? '';
  const second = labels[labels.length - 2] ?? '';
  if (tld === 'br') return BR_SECOND_LEVELS.has(second) ? 2 : 1;
  return tld.length === 2 && SECOND_LEVEL_SUFFIXES.has(second) ? 2 : 1;
}

/** The zone a hostname lives in: `shop.acme.com.br` → `acme.com.br`. */
export function dnsZoneOf(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/\.$/, '').split('.');
  return labels.slice(-(suffixLength(labels) + 1)).join('.');
}

/** True when the hostname IS its zone (`acme.com.br`), not a subdomain of it. */
export function isZoneApex(hostname: string): boolean {
  return dnsZoneOf(hostname) === hostname.toLowerCase().replace(/\.$/, '');
}

/**
 * The provider's host-name field for `fqdn` inside `hostname`'s zone: `@` for
 * the zone itself, otherwise the labels before it
 * (`_verify.shop.acme.com.br` → `_verify.shop`).
 */
export function relativeDnsName(fqdn: string, hostname: string): string {
  // A row that reached the screen without its record name renders an empty
  // field rather than taking the whole page down.
  if (!fqdn || !hostname) return '';
  const name = fqdn.toLowerCase().replace(/\.$/, '');
  const zone = dnsZoneOf(hostname);
  if (name === zone) return '@';
  return name.endsWith(`.${zone}`) ? name.slice(0, -(zone.length + 1)) : name;
}

/**
 * The `www.` a root claim registers beside it, or null for a subdomain claim,
 * which stays one name. A hostname that already starts with `www.` is a
 * subdomain of its zone, so it is never doubled.
 */
export function wwwCompanionOf(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return isZoneApex(host) ? `www.${host}` : null;
}

/** The DNS record type that carries a target: AAAA for IPv6, A for IPv4, CNAME for a hostname. */
export type PointingRecordType = 'A' | 'AAAA' | 'CNAME';

/**
 * Which record a target goes into. An IPv6 address pasted into an A record is
 * refused by every registrar, so a dual-stacked deploy has to say which of its
 * addresses is which. Any colon means IPv6: no IPv4 address or hostname
 * contains one.
 */
export function pointingRecordType(target: string): PointingRecordType {
  if (target.includes(':')) return 'AAAA';
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(target) ? 'A' : 'CNAME';
}

/** One record as a provider's form asks for it. */
export interface DnsRecordSpec {
  type: 'TXT' | PointingRecordType;
  /** Relative to the zone: `@`, `www`, `shop`, the TXT prefix. */
  name: string;
  /** The same name, fully qualified, for a provider that asks for it. */
  fqdn: string;
  /** One record per value (a TXT has one; a deploy may have several IPs). */
  values: string[];
}

/** Everything a tenant publishes for one domain. */
export interface TenantDomainDns {
  zone: string;
  /** `apex`: the root + `www` pair; `subdomain`: one name. */
  kind: 'apex' | 'subdomain';
  /** The names the domain answers on: the root and its `www.`, or the one subdomain. */
  hostnames: string[];
  /** The ownership TXT record, at the root for a pair (it proves both names). */
  verification: DnsRecordSpec;
  /**
   * Where each name points: one record per name and record type, in the
   * deploy's target order. Empty when the deploy does not know its address.
   */
  pointing: DnsRecordSpec[];
  /**
   * The relative names whose OTHER pointing records must be deleted: an old
   * site's A/AAAA (and a subdomain's CNAME) keep answering beside ours.
   */
  replaceRecordsNamed: string[];
}

/** The DNS records of one domain, under the host's TXT prefix. */
export interface TenantDomainDnsRecords {
  /** The validated prefix, as given. */
  readonly recordPrefix: string;
  /** The FQDN the ownership TXT record lives at: one per domain, at the root for a pair. */
  verificationRecordName(hostname: string): string;
  /**
   * The records for a domain: `hostname` is the claimed name (the ROOT of a
   * pair), `wwwHostname` its companion or null, `verificationToken` the TXT value.
   */
  recordsOf(
    domain: { hostname: string; wwwHostname: string | null; verificationToken: string },
    dnsTargets: readonly string[],
  ): TenantDomainDns;
}

/** One DNS label, an underscore allowed in front (`_verify`), as a TXT record's owner name takes it. */
const RECORD_PREFIX_RE = /^_?[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** The TXT prefix, checked. Throws {@link TenantConfigError} under `key`. */
export function validateRecordPrefix(value: unknown, key: string): string {
  if (value === undefined || value === null) throw new TenantConfigError(key, 'is required and missing');
  if (typeof value !== 'string' || !RECORD_PREFIX_RE.test(value) || value.length > 63) {
    throw new TenantConfigError(key, 'must be one lowercase DNS label (letters, digits, "-", an optional leading "_")');
  }
  return value;
}

/** One record per type for `fqdn`, in the deploy's order: an A with its IPv4s, an AAAA with its IPv6s. */
function pointingFor(fqdn: string, zoneHost: string, dnsTargets: readonly string[]): DnsRecordSpec[] {
  const types = dnsTargets.map(pointingRecordType);
  return [...new Set(types)].map((type) => ({
    type,
    name: relativeDnsName(fqdn, zoneHost),
    fqdn,
    values: dnsTargets.filter((_, at) => types[at] === type),
  }));
}

/** The record builder under the host's TXT prefix (`{ recordPrefix }`, required, one DNS label). */
export function createDomainDns(config: { recordPrefix: string }): TenantDomainDnsRecords {
  if (config === null || typeof config !== 'object') {
    throw new TenantConfigError('recordPrefix', 'is required and missing');
  }
  const recordPrefix = validateRecordPrefix((config as { recordPrefix?: unknown }).recordPrefix, 'recordPrefix');
  const verificationRecordName = (hostname: string): string => `${recordPrefix}.${hostname}`;
  return {
    recordPrefix,
    verificationRecordName,
    recordsOf: (domain, dnsTargets) => {
      const hostnames = domain.wwwHostname === null ? [domain.hostname] : [domain.hostname, domain.wwwHostname];
      const txt = verificationRecordName(domain.hostname);
      return {
        zone: dnsZoneOf(domain.hostname),
        kind: domain.wwwHostname === null ? 'subdomain' : 'apex',
        hostnames,
        verification: {
          type: 'TXT',
          name: relativeDnsName(txt, domain.hostname),
          fqdn: txt,
          values: [domain.verificationToken],
        },
        pointing: hostnames.flatMap((host) => pointingFor(host, domain.hostname, dnsTargets)),
        replaceRecordsNamed: hostnames.map((host) => relativeDnsName(host, domain.hostname)),
      };
    },
  };
}
