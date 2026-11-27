/**
 * The platform's archive confirmation: the dangerous act done on the owner's
 * behalf. It says what happens and until when it can be undone, lists what
 * still blocks it (read-only: the owner resolves it), what follows, what cannot
 * be undone, and asks the reason (it goes to the owner by e-mail) and the
 * presser's PIN. No typed name: the platform's entry does not ask it.
 *
 * It fills the host's overlay shell (a side panel on a computer, a bottom sheet
 * on a phone): the title row, a body that is the ONLY scroller (so the PIN
 * field is never cut by the actions), and the actions pinned to the bottom.
 * While the act is with the server the close button, the way back, the veil and
 * Escape are inert. A refusal stays inside the panel, above the actions.
 */
import { useEffect, useRef, useState, type JSX } from 'react';

import CalendarTodayOutlinedIcon from '@mui/icons-material/CalendarTodayOutlined';
import CloseIcon from '@mui/icons-material/Close';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import { Alert } from '@12-apps/ui/data-display/Alert';
import { Button } from '@12-apps/ui/form/Button';
import { Textarea } from '@12-apps/ui/form/Textarea';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { sxRem } from '@12-apps/ui/tokens';
import { Heading } from '@12-apps/ui/typography/Heading';
import { Text } from '@12-apps/ui/typography/Text';

import { REASON_MAX, REASON_MIN, messageOf } from './close-dialog';
import { usePlatformConfig } from './context';
import type { TenantLifecycleCopy } from './copy';
import { Emphasis, Fact, PendingList, SectionTitle } from './platform-parts';
import type { TenantClosingBlocker, TenantLifecyclePin, TenantQuery } from './types';

export interface ArchivePanelProps<P extends TenantLifecyclePin> {
  open: boolean;
  /** The tenant's name, as the title asks it. */
  name: string;
  /** The deletion day, long (the last day it can be restored). */
  purgeDay: string;
  /** The same day, short, as the owner's e-mail fact says it. */
  purgeShortDay: string;
  /** What still blocks the archive (the host's read). */
  blockers: TenantQuery<readonly TenantClosingBlocker[]>;
  /** The presser's PIN (the host's hook, for this tenant's unlock). */
  pin: P;
  /** The resolved pack for this render. */
  copy: TenantLifecycleCopy;
  /** Sends the archive with the trimmed reason; resolves once it landed and the host re-read; throws the refusal. */
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}

const GUTTER = 2.5;
const ACTION = { minHeight: sxRem(44) } as const;

interface ContentProps extends Omit<ArchivePanelProps<TenantLifecyclePin>, 'open'> {
  /** Closes after the act landed (the guarded close refuses while busy). */
  onDone: () => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}

function Facts({ copy, purgeDay, purgeShortDay }: Pick<ContentProps, 'copy' | 'purgeDay' | 'purgeShortDay'>): JSX.Element {
  return (
    <Box data-testid="archive-facts">
      <Fact icon={<MailOutlineIcon />} dataTestId="archive-fact-email">
        <Emphasis value={copy.platformFactEmail(purgeShortDay)} />
      </Fact>
      <Fact icon={<CalendarTodayOutlinedIcon />} dataTestId="archive-fact-purge">
        <Emphasis value={copy.platformFactPurge(purgeDay)} />
      </Fact>
      <Fact icon={<PersonOutlineIcon />} dataTestId="archive-fact-audit">
        {copy.platformFactAudit}
      </Fact>
    </Box>
  );
}

interface FormState {
  reason: string;
  setReason: (reason: string) => void;
  held: boolean;
  error: string | null;
}

function PanelHeader({ copy, name, held, onClose }: { copy: TenantLifecycleCopy; name: string; held: boolean; onClose: () => void }): JSX.Element {
  return (
    <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ px: GUTTER, pt: 2.25, pb: 1.25 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Heading level="h2" size="h5">{copy.platformArchiveTitle(name)}</Heading>
      </Box>
      <Button variant="ghost" color="neutral" size="sm" aria-label={copy.closeLabel} disabled={held} onClick={onClose} dataTestId="archive-close" sx={ACTION}>
        <CloseIcon aria-hidden />
      </Button>
    </Stack>
  );
}

function PanelBody(props: Pick<ContentProps, 'copy' | 'purgeDay' | 'purgeShortDay' | 'blockers' | 'pin'> & FormState): JSX.Element {
  const { copy, purgeDay, purgeShortDay, blockers, pin, reason, setReason, held, error } = props;
  const { PinFields, UndoNote } = usePlatformConfig().components;
  const errorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (error !== null) errorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [error]);
  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: GUTTER, pb: 1.5 }} data-testid="archive-panel-body">
      <Text>{copy.platformArchiveLead(purgeDay)}</Text>
      <SectionTitle>{copy.platformPendingTitle}</SectionTitle>
      <PendingList blockers={blockers} copy={copy} />
      <SectionTitle>{copy.platformAfterTitle}</SectionTitle>
      <Facts copy={copy} purgeDay={purgeDay} purgeShortDay={purgeShortDay} />
      <Box sx={{ mt: 1.25 }}>
        <UndoNote text={copy.platformUndo(purgeDay)} dataTestId="archive-undo" />
      </Box>
      <Box sx={{ mt: 1.75 }}>
        <Textarea
          label={copy.reasonLabel}
          placeholder={copy.platformReasonPlaceholder}
          helperText={copy.platformReasonHelp}
          variant="autosize"
          minRows={2}
          maxRows={6}
          maxLength={REASON_MAX}
          required
          value={reason}
          disabled={held}
          onChange={(event) => setReason(event.target.value)}
          dataTestId="archive-reason"
        />
      </Box>
      <PinFields pin={pin} />
      {error === null ? null : (
        <Box ref={errorRef} sx={{ mt: 1.5 }}>
          <Alert variant="danger" description={error} dataTestId="archive-error" />
        </Box>
      )}
    </Box>
  );
}

interface ActionsProps {
  copy: TenantLifecycleCopy;
  ready: boolean;
  held: boolean;
  pending: number;
  onConfirm: () => void;
  onClose: () => void;
}

/** The verb first, then the way back, from the left; what is missing beside them (or under them, when it does not fit). */
function PanelActions({ copy, ready, held, pending, onConfirm, onClose }: ActionsProps): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      flexWrap="wrap"
      useFlexGap
      sx={{ borderTop: 1, borderColor: 'divider', px: GUTTER, pt: 1.5, pb: 2 }}
      data-testid="archive-actions"
    >
      <Button color="danger" disabled={!ready} loading={held} onClick={onConfirm} dataTestId="archive-confirm" sx={ACTION}>
        {copy.closeAction}
      </Button>
      <Button variant="outline" disabled={held} onClick={onClose} dataTestId="archive-back" sx={ACTION}>
        {copy.cancel}
      </Button>
      {pending > 0 ? <Text color="secondary" data-testid="archive-missing">{copy.missing(pending)}</Text> : null}
    </Stack>
  );
}

function PanelContent(props: ContentProps): JSX.Element {
  const { name, blockers, pin, copy, onConfirm, onClose, onDone, busy, setBusy } = props;
  const { toast } = usePlatformConfig();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pending = blockers.data?.length ?? 0;
  const held = busy || pin.busy;
  const ready = blockers.data !== undefined && pending === 0 && reason.trim().length >= REASON_MIN && pin.ready;

  async function confirm(): Promise<void> {
    if (!ready || held || !(await pin.confirm())) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setBusy(false);
      toast(copy.platformArchivedToast(name), { severity: 'success', testId: 'archive-toast' });
      onDone();
    } catch (failure) {
      setBusy(false);
      setError(messageOf(failure, copy.actFailed));
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }} data-testid="archive-panel-content">
      <PanelHeader copy={copy} name={name} held={held} onClose={onClose} />
      <PanelBody {...props} reason={reason} setReason={setReason} held={held} error={error} />
      <PanelActions copy={copy} ready={ready} held={held} pending={pending} onConfirm={() => void confirm()} onClose={onClose} />
    </Box>
  );
}

export function ArchivePanelScreen<P extends TenantLifecyclePin>(props: ArchivePanelProps<P>): JSX.Element {
  const { Overlay } = usePlatformConfig().components;
  const [busy, setBusy] = useState(false);
  const { open, onClose, ...rest } = props;
  // Nothing closes the panel while the act is with the server: the veil, Escape, the close button and the way back.
  const close = () => {
    if (!busy && !props.pin.busy) onClose();
  };
  return (
    <Overlay open={open} onClose={close} label={props.copy.platformArchiveTitle(props.name)} dataTestId="archive-panel">
      {/* Mounted only while open: a panel opened again starts empty. */}
      {open ? <PanelContent {...rest} onClose={close} onDone={onClose} busy={busy} setBusy={setBusy} /> : null}
    </Overlay>
  );
}
