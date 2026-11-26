/**
 * What every part of the screen reads without a prop: the resolved pack and
 * the host's two widgets. The card provides it; a part rendered outside the
 * card (the records, standalone) takes its copy as a prop instead.
 */
import { createContext, useContext, type ComponentType, type ReactNode } from 'react';

import { useTheme } from '@12-apps/ui/mui/styles';
import useMediaQuery from '@12-apps/ui/mui/useMediaQuery';

import type { DnsRecordSpec } from '../dns-names';
import type { TenantDomainsCopy } from './copy';

/** A domain as the screen reads it: the host's wire view (dates as ISO strings). */
export interface TenantDomainItem {
  id: string;
  /** The claimed name: the root of a pair, or the one subdomain. */
  hostname: string;
  /** A root claim's `www.` companion; null for a subdomain. */
  wwwHostname: string | null;
  principal: 'root' | 'www';
  principalHostname: string;
  status: string;
  /** The FQDN the verification TXT record is published at. */
  recordName: string;
  dnsRecords: { verification: DnsRecordSpec; pointing: DnsRecordSpec[] };
  /** `null` is unknown and is never told as a problem; only `false` is. */
  dnsPointsHere: boolean | null;
  /** The tenant's main domain: the platform address redirects to its principal name. */
  canonical: boolean;
  archived: boolean;
  archivedAt: string | null;
  archivedBy: { userId: string; name: string | null } | null;
  verifiedAt: string | null;
  createdAt: string;
}

/** The host's confirm-gated button (its own words for the popup's chrome). */
export type TenantDomainsConfirmButton = ComponentType<{
  variant: 'outline';
  color: 'primary';
  size: 'sm';
  disabled?: boolean;
  onClick: () => Promise<void>;
  confirm: { title: string; entityName: string; description: string; confirmText: string };
  dataTestId?: string;
  children?: ReactNode;
}>;

/** The host's one-line choice of equal parts. */
export type TenantDomainsSegmented = ComponentType<{
  label: string;
  value: 'root' | 'www';
  options: readonly { value: 'root' | 'www'; label: string }[];
  disabled?: boolean;
  busy?: boolean;
  dataTestId: string;
  onPick: (next: 'root' | 'www') => void;
}>;

/** The widgets the host binds to its own words and look, injected rather than copied. */
export interface TenantDomainsComponents {
  ConfirmButton: TenantDomainsConfirmButton;
  Segmented: TenantDomainsSegmented;
}

interface ScreenContext {
  copy: TenantDomainsCopy;
  components: TenantDomainsComponents;
}

const DomainsScreenContext = createContext<ScreenContext | null>(null);

export const DomainsScreenProvider = DomainsScreenContext.Provider;

/** The screen's pack and widgets; only inside the card. */
export function useDomainsScreen(): ScreenContext {
  const screen = useContext(DomainsScreenContext);
  if (screen === null) {
    throw new Error('@12-apps/tenant: a domains screen part was rendered outside its DomainsCard.');
  }
  return screen;
}

/**
 * Below `sm` the phone says some lines shorter: the principal control's parts,
 * step 1's lead-in, the delete advice and the active line. One question, asked once.
 */
export function usePhoneCopy(): boolean {
  return useMediaQuery(useTheme().breakpoints.down('sm'));
}
