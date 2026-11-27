/**
 * The banner every screen of the host's app shows while the tenant is
 * closing: since when, when the data goes, that the app is read-only, and the
 * reopen. Only whoever holds the close permission still reaches a closing
 * tenant's app, so only they ask; an open tenant draws nothing. Amber, never
 * red: the close is still reversible. Not on the close page itself, whose own
 * card says all of this (one place per thing).
 */
import type { JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';

import { TOUCH } from './close-cards';
import { useReopenWithToast, useShortDay } from './close-states';
import { useClosingConfig } from './context';
import type { TenantLifecycleCopy } from './copy';

export interface ClosingBannerProps {
  slug: string;
  /** The resolved pack for this render. */
  copy: TenantLifecycleCopy;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export function ClosingBannerScreen({ slug, copy }: ClosingBannerProps): JSX.Element | null {
  const { hooks, statuses, paths } = useClosingConfig();
  const holds = hooks.useHoldsClose();
  const state = hooks.useClosingState(slug, holds && slug !== '');
  const reopen = useReopenWithToast(slug, copy);
  const pathname = hooks.usePathname();
  const day = useShortDay();
  const onClosePage = new RegExp(`/${escapeRegExp(paths.closePage)}/?$`, 'u').test(pathname);
  if (state.data?.status !== statuses.closing || onClosePage) return null;
  return (
    <Box sx={{ px: { xs: 2, md: 3 }, pt: 2 }} data-testid="closing-banner">
      <Alert variant="warning" title={copy.bannerTitle} description={copy.bannerBody(day(state.data.requestedAt), day(state.data.purgeAt))}>
        <Box sx={{ mt: 0.5, typography: 'body2' }} data-testid="closing-banner-read-only">
          {copy.bannerReadOnly}
        </Box>
        {reopen.isError ? (
          <Box role="alert" sx={{ mt: 1, typography: 'body2', color: 'error.dark' }} data-testid="closing-banner-error">
            {reopen.error?.message}
          </Box>
        ) : null}
        <Stack direction="row" sx={{ mt: 1 }}>
          <Button size="sm" loading={reopen.isPending} onClick={reopen.run} dataTestId="closing-banner-reopen" sx={TOUCH}>
            {copy.reopen}
          </Button>
        </Stack>
      </Alert>
    </Box>
  );
}
