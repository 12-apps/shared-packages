/**
 * The card's widget and item types accept a real host's shapes (FUT-5638,
 * round-1 finding). The checks are compile-time: this file is in the package's
 * `tsc`, so narrowing `TenantDomainsComponents` back to `ComponentType`, or the
 * item record's `type` back to a union, fails here instead of in the host's
 * catalog bump.
 *
 * - The confirm button is `@12-apps/ui`'s `createConfirmButton(...)`, whose
 *   `defaultProps.variant` a `ComponentType` refuses.
 * - The choice of equal parts is generic (`value: T | null`), as a host's
 *   shared segmented control is.
 * - A host's wire view types a DNS record's `type` as a plain string.
 */
import type { JSX } from 'react';
import { createConfirmButton } from '@12-apps/ui/feedback/ConfirmAction';
import { describe, expect, it } from 'vitest';

import type { TenantDomainItem, TenantDomainsComponents } from '../domains/react';

declare const confirmCopy: Parameters<typeof createConfirmButton>[0];

function HostSegmented<T extends string>(props: {
  label: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  busy?: boolean;
  dataTestId: string;
  ariaLabels?: Partial<Record<T, string>>;
  fit?: boolean;
  onPick: (next: T) => void;
}): JSX.Element {
  return <span data-testid={props.dataTestId}>{props.label}</span>;
}

interface HostDnsRecord {
  type: string;
  name: string;
  fqdn: string;
  values: string[];
}

interface HostDomain {
  id: string;
  hostname: string;
  wwwHostname: string | null;
  principal: 'root' | 'www';
  principalHostname: string;
  status: string;
  verifiedAt: string | null;
  createdAt: string;
  recordName: string;
  dnsRecords: { verification: HostDnsRecord; pointing: HostDnsRecord[] };
  dnsPointsHere: boolean | null;
  canonical: boolean;
  archived: boolean;
  archivedAt: string | null;
  archivedBy: { userId: string; name: string | null } | null;
}

/** Compile-time only: each assignment is the check. */
export function hostShapesFit(hostDomain: HostDomain): readonly [TenantDomainsComponents, TenantDomainItem] {
  const components: TenantDomainsComponents = {
    ConfirmButton: createConfirmButton(confirmCopy, 'confirm'),
    Segmented: HostSegmented,
  };
  const item: TenantDomainItem = hostDomain;
  return [components, item];
}

describe('domains host shapes', () => {
  it('are checked by the package type check (this file compiles)', () => {
    expect(typeof hostShapesFit).toBe('function');
  });
});
