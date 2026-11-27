/**
 * The pieces the platform's archive confirmation and its card share: the
 * read-only pending list, a section heading, a fact line with its icon, and a
 * sentence with a part in bold.
 */
import type { JSX, ReactNode } from 'react';

import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { ErrorState } from '@12-apps/ui/data-display/ErrorState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { sxRem } from '@12-apps/ui/tokens';
import { Text } from '@12-apps/ui/typography/Text';

import type { TenantEmphasis, TenantLifecycleCopy } from './copy';
import type { TenantClosingBlocker, TenantQuery } from './types';

/** A sentence with its bold part. */
export function Emphasis({ value }: { value: TenantEmphasis }): JSX.Element {
  return (
    <>
      {value.before}
      <Box component="b" sx={{ fontWeight: 'fontWeightBold' }}>{value.bold}</Box>
      {value.after}
    </>
  );
}

/** A section's small heading inside the panel or the card. */
export function SectionTitle({ children, first = false, level = 'h3' }: { children: string; first?: boolean; level?: 'h3' | 'h4' }): JSX.Element {
  return (
    <Box component={level} sx={{ typography: 'subtitle2', color: 'text.secondary', m: 0, mt: first ? 0 : 2, mb: 1 }}>
      {children}
    </Box>
  );
}

/** One fact with its icon, the icon in the secondary ink. */
export function Fact({ icon, children, dataTestId }: { icon: ReactNode; children: ReactNode; dataTestId: string }): JSX.Element {
  return (
    <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ py: 0.75 }} data-testid={dataTestId}>
      <Box sx={{ color: 'text.secondary', display: 'flex', flex: 'none', '& svg': { fontSize: sxRem(20) } }} aria-hidden>
        {icon}
      </Box>
      <Box sx={{ typography: 'body1' }}>{children}</Box>
    </Stack>
  );
}

const ROW = { py: 1.125, borderBottom: 1, borderColor: 'divider' } as const;

function BlockerRows({ blockers, copy }: { blockers: readonly TenantClosingBlocker[]; copy: TenantLifecycleCopy }): JSX.Element {
  if (blockers.length === 0) {
    return (
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ py: 1.125 }} data-testid="archive-pending-none">
        <CheckCircleOutlineIcon fontSize="small" sx={{ color: 'text.secondary' }} aria-hidden />
        <Text>{copy.platformPendingNone}</Text>
      </Stack>
    );
  }
  return (
    <>
      {blockers.map((blocker, index) => (
        <Stack
          key={blocker.kind}
          direction="row"
          spacing={1.25}
          alignItems="center"
          sx={index === blockers.length - 1 ? { py: 1.125 } : ROW}
          data-testid={`archive-blocker-${blocker.kind}`}
        >
          <InfoOutlinedIcon fontSize="small" sx={{ color: 'warning.dark' }} aria-hidden />
          <Text>{copy.blocker(blocker.kind, blocker.count)}</Text>
        </Stack>
      ))}
      <Box sx={{ typography: 'body2', color: 'text.secondary', pb: 1.125, pl: sxRem(30) }} data-testid="archive-pending-hint">
        {copy.platformPendingHint}
      </Box>
    </>
  );
}

/**
 * What still blocks the archive, read-only: the owner resolves it in their
 * own app. Loading and a failed read say so in place, with the retry.
 */
export function PendingList({ blockers, copy }: { blockers: TenantQuery<readonly TenantClosingBlocker[]>; copy: TenantLifecycleCopy }): JSX.Element {
  if (blockers.isPending) return <LoadingState dataTestId="archive-pending-loading" />;
  if (blockers.isError || blockers.data === undefined) {
    return (
      <ErrorState
        title={copy.loadFailed}
        message={blockers.error?.message ?? ''}
        retryLabel={copy.retry}
        onRetry={() => void blockers.refetch()}
      />
    );
  }
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', px: 1.5, py: 0.5 }} data-testid="archive-pending">
      <BlockerRows blockers={blockers.data} copy={copy} />
    </Box>
  );
}
