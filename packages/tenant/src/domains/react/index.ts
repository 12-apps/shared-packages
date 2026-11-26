/**
 * `@12-apps/tenant/domains/react`: the custom-domains screen. Every word is
 * the host's pack and the two widgets that carry the host's own words and look
 * (a confirm-gated button, a one-line choice) are injected, so the package
 * ships the screen's structure, not its language or chrome.
 *
 * Needs `react`, `@12-apps/ui` and `@mui/icons-material` (optional peers);
 * `@12-apps/tenant/react` keeps needing none of them.
 */
export { createDomainsScreen, validateDomainsScreen, type TenantDomainsScreenConfig } from './screen';
export {
  PairAnnouncement,
  type DomainsCardProps,
  type TenantDomainRefusal,
  type TenantDomainWrite,
  type TenantDomainWrites,
} from './card';
export {
  type TenantDomainItem,
  type TenantDomainItemRecord,
  type TenantDomainsComponents,
  type TenantDomainsConfirmButton,
  type TenantDomainsSegmented,
} from './context';
export {
  TENANT_DOMAINS_COPY_SHAPE,
  type TenantDomainPairCopy,
  type TenantDomainRecordsCopy,
  type TenantDomainsCopy,
} from './copy';
export {
  PairPointingRecord,
  PointingRecord,
  PointingWarning,
  VerificationRecord,
  domainName,
  pointingRecordType,
  removalConsequence,
  statusLabelFor,
  type PointingRecordType,
} from './records';
