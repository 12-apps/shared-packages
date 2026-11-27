/**
 * The platform's archive card, the last card of the tenant's settings.
 *
 * - Open (a status the platform may archive from): the pending list, what
 *   happens, and the entry to the confirmation (the secondary button, never
 *   red: the red is the confirmation's own). The entry is never disabled: the
 *   confirmation says what is missing.
 * - Archived (closing): who archived it, when and why, the deletion day, and
 *   the restore.
 * - Any other status (not approved yet, purged): nothing to archive or
 *   restore, so no card.
 *
 * The buttons only call the host: it opens the one confirmation (the same
 * component its menu opens) and its own restore confirmation.
 */
import type { JSX } from 'react';

import CalendarTodayOutlinedIcon from '@mui/icons-material/CalendarTodayOutlined';
import { Button } from '@12-apps/ui/form/Button';
import { Card, CardContent } from '@12-apps/ui/layout/Card';
import { Box } from '@12-apps/ui/mui/Box';
import type { Theme } from '@12-apps/ui/mui/styles';
import { rem, sxRem } from '@12-apps/ui/tokens';
import { Heading } from '@12-apps/ui/typography/Heading';
import { Text } from '@12-apps/ui/typography/Text';

import { usePlatformConfig } from './context';
import type { TenantArchivedFacts, TenantLifecycleCopy } from './copy';
import { Emphasis, Fact, PendingList, SectionTitle } from './platform-parts';
import type { TenantClosingBlocker, TenantQuery } from './types';

export interface ArchiveCardProps {
  /** The tenant's status, the host's value. */
  status: string;
  /** The resolved pack for this render. */
  copy: TenantLifecycleCopy;
  /** Open: what still blocks the archive (the host's read). */
  blockers: TenantQuery<readonly TenantClosingBlocker[]>;
  /** Open: the last day an archive made now could be restored. Archived: the deletion day. Long form. */
  purgeDay: string;
  /** Archived: who, when and why; null while open. */
  archived: TenantArchivedFacts | null;
  /** The presser may archive (the host's permission). Without it the card still says what it says. */
  canArchive: boolean;
  /** The presser may restore (the host's permission). */
  canRestore: boolean;
  /** Open the archive confirmation. */
  onArchive: () => void;
  /** Open the host's restore confirmation. */
  onRestore: () => void;
}

/** Two equal columns from this container width, one below it. */
const COLUMNS = (theme: Theme) => ({
  containerType: 'inline-size',
  '& > .archive-columns': {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 1.5,
    [`@container (min-width: ${rem(theme, 600)})`]: { gridTemplateColumns: '1fr 1fr', gap: 3 },
  },
});

const ACTION = { minHeight: sxRem(44), mt: 2 } as const;

function OpenBody(props: ArchiveCardProps): JSX.Element {
  const { copy, blockers, purgeDay, canArchive, onArchive } = props;
  return (
    <>
      <Box sx={COLUMNS}>
        <Box className="archive-columns">
          <Box>
            <SectionTitle first level="h4">{copy.platformPendingTitle}</SectionTitle>
            <PendingList blockers={blockers} copy={copy} />
          </Box>
          <Box>
            <SectionTitle first level="h4">{copy.platformCardWhat}</SectionTitle>
            <Text>{copy.platformArchiveLead(purgeDay)}</Text>
          </Box>
        </Box>
      </Box>
      {canArchive ? (
        <Button variant="outline" onClick={onArchive} dataTestId="archive-open" sx={ACTION}>
          {copy.closeAction}
        </Button>
      ) : null}
    </>
  );
}

function ArchivedBody({ copy, archived, purgeDay, canRestore, onRestore }: ArchiveCardProps): JSX.Element {
  return (
    <>
      {archived === null ? null : (
        <Box sx={{ typography: 'body1' }} data-testid="archive-archived">
          <Emphasis value={copy.platformArchived(archived)} />
        </Box>
      )}
      <Box sx={{ mt: 0.75 }}>
        <Fact icon={<CalendarTodayOutlinedIcon />} dataTestId="archive-purge">
          <Emphasis value={copy.platformPurgeFact(purgeDay)} />
        </Fact>
      </Box>
      {canRestore ? (
        <Button variant="outline" onClick={onRestore} dataTestId="archive-restore" sx={ACTION}>
          {copy.platformRestore}
        </Button>
      ) : null}
    </>
  );
}

export function ArchiveCardScreen(props: ArchiveCardProps): JSX.Element | null {
  const { statuses } = usePlatformConfig();
  const open = statuses.closableFrom.includes(props.status);
  const archived = props.status === statuses.closing;
  if (!open && !archived) return null;
  return (
    <Card variant="outlined" data-testid="archive-card">
      <CardContent>
        <Box sx={{ mb: 1.5 }}>
          <Heading level="h3" size="h6">{props.copy.platformCardTitle}</Heading>
        </Box>
        {archived ? <ArchivedBody {...props} /> : <OpenBody {...props} />}
      </CardContent>
    </Card>
  );
}
