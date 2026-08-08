import type { JSX, ReactNode } from 'react';

import { Sidebar, SidebarContent, SidebarHeader } from '@12-apps/ui/layout/Sidebar';
import { Box } from '@12-apps/ui/mui/Box';
import { alpha, type Theme } from '@12-apps/ui/mui/styles';
import { Text } from '@12-apps/ui/typography/Text';

import { HarnessNav } from './harness-nav';

/**
 * The harness chrome — the shape future-pay's admin shell has
 * (`apps/admin/src/shell/admin-shell.tsx`): a fixed-viewport flex row where a
 * `Sidebar` and the content each own an independent scroll region, the sidebar
 * panel tinted a few percent of primary so it reads as chrome rather than as
 * more page.
 *
 * The admin's shell does three further things this one has no use for: it
 * resolves the actor's permissions and the tenant's entitlements before it can
 * draw a row, it swaps to an overlay drawer on phones, and it persists the
 * rail and section state per tenant+user. None of those have a meaning here —
 * there is no actor, no tenant, and the harness is opened to look at one page.
 */

/** Subtle primary tint that distinguishes the sidebar panel from the content. */
export const panelBg = (t: Theme): string => alpha(t.palette.primary.main, 0.04);

/** Stacked-layers mark, drawn rather than imported — the sidebar's only art. */
function BrandMark(): JSX.Element {
  return (
    <Box component="span" sx={{ display: 'inline-flex', color: 'primary.main', flex: '0 0 auto' }}>
      <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m12 3 9 5-9 5-9-5 9-5Z" fill="currentColor" opacity={0.9} />
        <path
          d="m3 12 9 5 9-5"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.5}
        />
        <path
          d="m3 16 9 5 9-5"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.3}
        />
      </svg>
    </Box>
  );
}

function BrandHeader(): JSX.Element {
  return (
    <Box
      data-testid="harness-brand-header"
      sx={{ display: 'flex', alignItems: 'center', width: '100%', p: 2, bgcolor: panelBg }}
    >
      <BrandMark />
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0, ml: 1 }}>
        <Text variant="heading" size="lg" as="span">
          Harness
        </Text>
        <Text variant="caption" size="xs" color="secondary" as="span">
          published
        </Text>
      </Box>
    </Box>
  );
}

export function HarnessShell({
  activeSlug,
  children,
}: {
  activeSlug: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar variant="fixed" width={280} dataTestId="harness-sidebar">
        <SidebarHeader style={{ padding: 0 }}>
          <BrandHeader />
        </SidebarHeader>
        <SidebarContent>
          <Box sx={{ bgcolor: panelBg, minHeight: '100%' }}>
            <HarnessNav activeSlug={activeSlug} />
          </Box>
        </SidebarContent>
      </Sidebar>
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', p: 3 }}>{children}</Box>
    </Box>
  );
}
