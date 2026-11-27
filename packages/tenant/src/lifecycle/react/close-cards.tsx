/**
 * The open tenant's three cards on the close page: what still blocks the
 * close (each with its shortcut), the data export, and the close itself.
 */
import { useEffect, useRef, useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Button } from '@12-apps/ui/form/Button';
import { Card, CardContent } from '@12-apps/ui/layout/Card';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { sxRem } from '@12-apps/ui/tokens';
import { Heading } from '@12-apps/ui/typography/Heading';
import { Text } from '@12-apps/ui/typography/Text';

import { CloseDialog } from './close-dialog';
import { useClosingConfig } from './context';
import type { TenantLifecycleCopy } from './copy';
import type { TenantClosingBlocker, TenantClosingView } from './types';

/** A card spanning both columns of the page's grid. */
export const SPAN = { gridColumn: '1 / -1' } as const;
/** A phone's touch target. */
export const TOUCH = { minHeight: sxRem(40) } as const;

interface CardProps {
  view: TenantClosingView;
  slug: string;
  copy: TenantLifecycleCopy;
}

function BlockerRow({ blocker, slug, copy }: { blocker: TenantClosingBlocker; slug: string; copy: TenantLifecycleCopy }): JSX.Element {
  const { Link } = useClosingConfig().components;
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      justifyContent="space-between"
      sx={{ py: 1, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}
      data-testid={`close-blocker-${blocker.kind}`}
    >
      <Text>{copy.blocker(blocker.kind, blocker.count)}</Text>
      {blocker.path === undefined ? null : (
        <Button
          variant="text"
          size="sm"
          component={Link}
          to={`/${slug}/${blocker.path}`}
          dataTestId={`close-blocker-${blocker.kind}-go`}
          sx={{ ...TOUCH, flexShrink: 0 }}
        >
          {copy.shortcut(blocker.kind)}
        </Button>
      )}
    </Stack>
  );
}

export function PendingCard({ view, slug, copy }: CardProps): JSX.Element {
  return (
    <Card variant="outlined" tabIndex={-1} sx={{ outline: 'none' }} data-testid="close-pending">
      <CardContent>
        <Heading level="h3" size="h6">{copy.pendingTitle}</Heading>
        {view.blockers.length === 0 ? (
          <Box sx={{ mt: 1 }}><Text color="secondary">{copy.pendingNone}</Text></Box>
        ) : (
          <Box sx={{ mt: 0.5 }}>
            {view.blockers.map((blocker) => (
              <BlockerRow key={blocker.kind} blocker={blocker} slug={slug} copy={copy} />
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export function DataCard({ slug, copy, numbered = true }: { slug: string; copy: TenantLifecycleCopy; numbered?: boolean }): JSX.Element {
  const config = useClosingConfig();
  const exportData = config.hooks.useRequestExport(slug);
  // Once asked, the job runs: the button stays off for this visit (a second ask would only answer the running one).
  const asked = exportData.isSuccess;
  // The pressed button goes disabled and drops focus: it lands on the sentence that says what happens next.
  const preparing = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (asked) preparing.current?.focus();
  }, [asked]);
  // The server's refusal says why; a request that never reached it is a connection to check, not a "no".
  const failure = exportData.isError ? (config.errorAnswer(exportData.error)?.message ?? copy.dataOffline) : null;
  return (
    <Card variant="outlined" data-testid="close-data">
      <CardContent>
        <Heading level="h3" size="h6">{numbered ? copy.dataTitle : copy.dataTitlePlain}</Heading>
        <Box sx={{ mt: 1 }}><Text color="secondary">{copy.dataNote}</Text></Box>
        {failure === null ? null : <Alert variant="danger" description={failure} sx={{ mt: 1.5 }} dataTestId="close-data-failed" />}
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
          <Button
            variant="outline"
            disabled={asked}
            loading={exportData.isPending}
            onClick={() => exportData.mutate()}
            dataTestId="close-data-export"
            sx={TOUCH}
          >
            {copy.dataAction}
          </Button>
          {asked ? (
            <Box ref={preparing} tabIndex={-1} role="status" sx={{ outline: 'none' }} data-testid="close-data-preparing">
              <Text color="secondary">{copy.dataPreparing}</Text>
            </Box>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

export function CloseCard({ view, slug, copy }: CardProps): JSX.Element {
  const config = useClosingConfig();
  const [asking, setAsking] = useState(false);
  const close = config.hooks.useClose(slug);
  const pending = view.blockers.length;
  return (
    <Card variant="outlined" data-testid="close-act" sx={SPAN}>
      <CardContent>
        <Heading level="h3" size="h6">{copy.closeTitle}</Heading>
        <Box sx={{ mt: 1 }}><Text color="secondary">{copy.closeExplain}</Text></Box>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
          <Button color="danger" disabled={pending > 0} onClick={() => setAsking(true)} dataTestId={`close-${config.testIdWord}-open`}>
            {copy.closeAction}
          </Button>
          {pending > 0 ? <Text color="secondary" data-testid="close-missing">{copy.missing(pending)}</Text> : null}
        </Stack>
      </CardContent>
      {asking ? (
        <CloseDialog
          name={view.name}
          copy={copy}
          onCancel={() => setAsking(false)}
          onConfirm={async (answer) => {
            await close.mutateAsync(answer);
            setAsking(false);
          }}
        />
      ) : null}
    </Card>
  );
}
