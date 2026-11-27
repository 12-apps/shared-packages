/**
 * The removed list: each removed domain, who removed it and when, that its
 * name is free, and the restore button, which works while nobody has taken the
 * name; otherwise the refusal is told in that domain's row. Open, as drawn.
 *
 * The toggle is hand-built rather than the library's `CollapsibleTrigger`,
 * which takes no `sx` (so no 44px row), paints the open state with a selected
 * wash and pushes its children apart, and sets neither `type="button"` nor
 * `aria-controls`.
 */
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useState, type JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Collapsible } from '@12-apps/ui/layout/Collapsible';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { sxRem } from '@12-apps/ui/tokens';
import { Text } from '@12-apps/ui/typography/Text';

import { useDomainsScreen, type TenantDomainItem } from './context';
import { domainName } from './records';
import { RowRefusal } from './row';

/** The day a domain was removed, as day and month in the pack's language. */
function removedOn(iso: string | null, locale: string): string {
  if (iso === null) return '';
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(new Date(iso));
}

/** One removed domain: its name, who removed it and when, a refused restore's reason, and the restore button. */
function RemovedRow({
  domain,
  busy,
  refusal,
  onDismissRefusal,
  onRestore,
}: {
  domain: TenantDomainItem;
  busy: boolean;
  refusal: string | null;
  onDismissRefusal: () => void;
  onRestore: () => void;
}): JSX.Element {
  const pair = useDomainsScreen().copy.pair;
  const refused = refusal !== null;
  return (
    <Stack
      direction={refused ? 'column' : 'row'}
      useFlexGap
      spacing={refused ? 1 : 2}
      sx={{ alignItems: refused ? 'flex-start' : 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
      data-testid="domain-removed-row"
    >
      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
        <Text variant="body" size="sm" as="span" style={{ overflowWrap: 'anywhere' }}>
          {domainName(domain, pair)}
        </Text>
        <Text variant="caption" size="xs" as="span">
          {pair.removedLine(removedOn(domain.archivedAt, pair.locale), domain.archivedBy?.name ?? null)}
        </Text>
      </Stack>
      {/* Told here, under the name and above the button tapped. */}
      {refusal !== null ? <RowRefusal message={refusal} testId="domain-restore-error" onDismiss={onDismissRefusal} /> : null}
      <Button variant="outline" color="primary" size="sm" disabled={busy} onClick={onRestore} dataTestId="domain-restore">
        {pair.restore}
      </Button>
    </Stack>
  );
}

export function RemovedList<D extends TenantDomainItem>({
  removed,
  isBusy,
  refusalOf,
  onDismissRefusal,
  onRestore,
}: {
  removed: D[];
  isBusy: (domain: D) => boolean;
  /** A refused restore's sentence for this domain, or null. */
  refusalOf: (domain: D) => string | null;
  onDismissRefusal: (domain: D) => void;
  onRestore: (domain: D) => void;
}): JSX.Element | null {
  const pair = useDomainsScreen().copy.pair;
  const [open, setOpen] = useState(true);
  if (removed.length === 0) return null;
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 2, py: 0.5 }} data-testid="domains-removed">
      <Box
        component="button"
        type="button"
        aria-expanded={open}
        aria-controls="domains-removed-list"
        onClick={() => setOpen(!open)}
        data-testid="domains-removed-toggle"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          width: '100%',
          minHeight: sxRem(44),
          p: 0,
          border: 0,
          bgcolor: 'transparent',
          color: 'text.primary',
          font: 'inherit',
          fontWeight: 600,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <ExpandMoreIcon fontSize="small" sx={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }} />
        {pair.removedTitle(removed.length)}
      </Box>
      <Collapsible open={open} keepMounted>
        <Stack id="domains-removed-list" spacing={1.5} sx={{ pb: 1.5 }}>
          {removed.map((domain) => (
            <RemovedRow
              key={domain.id}
              domain={domain}
              busy={isBusy(domain)}
              refusal={refusalOf(domain)}
              onDismissRefusal={() => onDismissRefusal(domain)}
              onRestore={() => onRestore(domain)}
            />
          ))}
        </Stack>
      </Collapsible>
    </Box>
  );
}
