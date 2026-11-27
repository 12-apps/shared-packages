/**
 * The screen a member a closing or closed tenant keeps out sees: the title
 * says what happened, the body what it means for them, and the one action
 * that goes somewhere — to another tenant they still have (straight to it when
 * there is one, the picker for several), or, with none, signing out.
 */
import type { JSX } from 'react';

import { EmptyState } from '@12-apps/ui/data-display/EmptyState';
import { Box } from '@12-apps/ui/mui/Box';

import { useClosingConfig } from './context';
import type { TenantLifecycleCopy } from './copy';

export interface TenantGoneScreenProps {
  /** Which refusal kept the member out (`closingRefusalOf`'s answer). */
  refusal: 'closing' | 'closed';
  /** The slugs of the other tenants the member still has. */
  otherSlugs: readonly string[];
  onSignOut: () => void;
  /** The resolved pack for this render. */
  copy: TenantLifecycleCopy;
  /** Where "switch tenant" goes (the factory's `switchTarget`). */
  switchTarget: (otherSlugs: readonly string[]) => string | null;
}

export function TenantGoneScreenBody({ refusal, otherSlugs, onSignOut, copy, switchTarget }: TenantGoneScreenProps): JSX.Element {
  const { testIdWord } = useClosingConfig();
  const target = switchTarget(otherSlugs);
  const closed = refusal === 'closed';
  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', px: 2 }} data-testid={`${testIdWord}-gone-screen`}>
      <EmptyState
        title={closed ? copy.refusedClosedTitle : copy.refusedClosingTitle}
        description={closed ? copy.refusedClosedBody : copy.refusedClosingBody}
        primaryAction={
          target === null
            ? { label: copy.signOut, onClick: onSignOut }
            : { label: copy.switchTenant, onClick: () => window.location.assign(target) }
        }
      />
    </Box>
  );
}
