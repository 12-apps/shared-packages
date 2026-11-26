/**
 * `@12-apps/tenant/domains`: the browser-safe half of custom domains. Pure
 * functions and types only (no Node module, no dependency), so a screen, a
 * shared host package and the server import the same file.
 *
 * The server half (the ports, the DNS checks, the engine, the TLS ask) is in
 * `@12-apps/tenant` and `@12-apps/tenant/server`; the screen in
 * `@12-apps/tenant/domains/react`. Adoption: ADOPTING.md, "Custom domains".
 */
export { draftHostname, hostnameOrNull } from './hostname';
export {
  createDomainDns,
  dnsZoneOf,
  isZoneApex,
  pointingRecordType,
  relativeDnsName,
  wwwCompanionOf,
  type DnsRecordSpec,
  type PointingRecordType,
  type TenantDomainDns,
  type TenantDomainDnsRecords,
} from './dns-names';
export {
  canonicalHostOf,
  domainOf,
  domainsOf,
  pairRedirectOf,
  principalHostOf,
  type TenantDomainName,
  type TenantDomainRecord,
  type TenantDomainRow,
  type TenantDomainStatus,
} from './record';
export {
  claimOf,
  claimableNames,
  guardedOf,
  namesOf,
  planDomainOperations,
  unitsOf,
  type TenantDomainOperation,
  type TenantDomainProblem,
  type TenantDomainProblemKind,
  type TenantDomainStep,
} from './plan';
