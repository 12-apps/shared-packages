/**
 * The owner's close page, in the order a person goes through it:
 *
 * 1. **Pending** — what still blocks the close, computed on the server, each
 *    line with the shortcut that resolves it.
 * 2. **Your data** — what the export holds and the button that asks for it: a
 *    job builds it and mails the link, so the card then says so and the button
 *    stays off. Shown while closing too: the data can be taken until the purge.
 * 3. **Close** — what happens, and the button, disabled with the count of what
 *    is missing while anything is pending. It opens the dangerous act's popup.
 *
 * While closing, the page says since when and until when, and offers the
 * reopen; once closed, one notice. A tenant neither open nor closing gets one
 * notice: it cannot be closed from here.
 */
import { useRef, type JSX } from 'react';

import { ErrorState } from '@12-apps/ui/data-display/ErrorState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Box } from '@12-apps/ui/mui/Box';
import type { Theme } from '@12-apps/ui/mui/styles';
import { rem } from '@12-apps/ui/tokens';

import { CloseCard, DataCard, PendingCard, SPAN } from './close-cards';
import { ClosingCard, NotClosableNotice } from './close-states';
import { useClosingConfig } from './context';
import type { TenantLifecycleCopy } from './copy';
import type { TenantClosingView } from './types';

/** Two columns from this container width, one below it (container queries, never the viewport). */
const GRID = (theme: Theme) => ({
  containerType: 'inline-size',
  // A paragraph never runs a whole wide line.
  maxWidth: rem(theme, 960),
  '& > .close-grid': {
    display: 'grid',
    gap: 2,
    gridTemplateColumns: '1fr',
    [`@container (min-width: ${rem(theme, 720)})`]: { gridTemplateColumns: '1fr 1fr' },
  },
});

export interface ClosePageProps {
  /** The tenant's slug: the hooks' key and the shortcuts' root. */
  slug: string;
  /** The resolved pack for this render. */
  copy: TenantLifecycleCopy;
}

interface BodyProps extends ClosePageProps {
  data: TenantClosingView;
  sawOpen: boolean;
  sawClosing: boolean;
}

function PageBody({ data, slug, copy, sawOpen, sawClosing }: BodyProps): JSX.Element {
  const { statuses } = useClosingConfig();
  if (data.status === statuses.active) {
    return (
      <>
        <PendingCard view={data} slug={slug} copy={copy} />
        <DataCard slug={slug} copy={copy} />
        <CloseCard view={data} slug={slug} copy={copy} />
      </>
    );
  }
  if (data.status !== statuses.closing && data.status !== statuses.closed) {
    return (
      <Box sx={SPAN}>
        <NotClosableNotice copy={copy} justReopened={sawClosing} />
      </Box>
    );
  }
  return (
    <>
      <Box sx={SPAN}>
        <ClosingCard view={data} slug={slug} copy={copy} focusOnMount={sawOpen} />
      </Box>
      {data.status === statuses.closing ? (
        <Box sx={SPAN}>
          <DataCard slug={slug} copy={copy} numbered={false} />
        </Box>
      ) : null}
    </>
  );
}

export function ClosePageScreen({ slug, copy }: ClosePageProps): JSX.Element {
  const { hooks, statuses, components } = useClosingConfig();
  const { Frame } = components;
  const view = hooks.useClosingView(slug);
  // Set once the page saw the tenant open: a later closing is the close this person just confirmed.
  const sawOpen = useRef(false);
  if (view.data?.status === statuses.active) sawOpen.current = true;
  // Set once the page saw it closing: a later live-but-not-open status is the reopen that restored a suspension.
  const sawClosing = useRef(false);
  if (view.data?.status === statuses.closing) sawClosing.current = true;
  if (view.isPending) return <LoadingState dataTestId="close-loading" />;
  const data = view.data;
  if (view.isError || data === undefined) {
    return (
      <ErrorState title={copy.loadFailed} message={view.error?.message ?? ''} retryLabel={copy.retry} onRetry={() => void view.refetch()} />
    );
  }
  return (
    <Frame eligible={data.status === statuses.active}>
      <Box sx={GRID} data-testid="config-close">
        <Box className="close-grid">
          <PageBody data={data} slug={slug} copy={copy} sawOpen={sawOpen.current} sawClosing={sawClosing.current} />
        </Box>
      </Box>
    </Frame>
  );
}
