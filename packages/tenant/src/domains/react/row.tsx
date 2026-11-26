/**
 * One claimed domain: its name and status, a pair's principal address
 * (pending or active), the records to publish, the pointing warning, where an
 * active one answers, and the verify / remove buttons.
 */
import { useEffect, useRef, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Chip } from '@12-apps/ui/data-display/Chip';
import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import { usePhoneCopy, useDomainsScreen, type TenantDomainItem } from './context';
import {
  PairPointingRecord,
  PointingRecord,
  PointingWarning,
  VerificationRecord,
  domainName,
  removalConsequence,
  statusLabelFor,
} from './records';

/**
 * One domain's refused write, told INSIDE that domain's row, by the control
 * that was tapped: at the head of the card it sat a phone's height above the
 * tap, and the tap looked like it did nothing. It comes into view as it
 * appears (nearest, with room for the control under it). No title: the row's
 * own heading already names the domain.
 */
export function RowRefusal({
  message,
  testId,
  onDismiss,
}: {
  message: string;
  testId: string;
  onDismiss: () => void;
}): JSX.Element {
  const { copy } = useDomainsScreen();
  const told = useRef<HTMLDivElement>(null);
  useEffect(() => {
    told.current?.scrollIntoView?.({ block: 'nearest' });
  }, [message]);
  return (
    <Box ref={told} sx={{ alignSelf: 'stretch', scrollMarginBottom: (theme) => theme.spacing(7) }}>
      <Alert
        variant="danger"
        description={message}
        closable
        closeLabel={copy.closeAlert}
        onClose={onDismiss}
        data-testid={testId}
      />
    </Box>
  );
}

/**
 * The row's action buttons: verify (while pending) and the confirm-gated
 * remove, from the left, the primary solid and the secondary its inverse.
 */
function DomainActions({
  domain,
  pending,
  busy,
  disabled,
  onVerify,
  onRemove,
}: {
  domain: TenantDomainItem;
  pending: boolean;
  busy: boolean;
  disabled: boolean;
  onVerify: () => void;
  onRemove: () => Promise<void>;
}): JSX.Element {
  const { copy, components } = useDomainsScreen();
  const { ConfirmButton } = components;
  return (
    <Stack direction="row" spacing={1}>
      {pending ? (
        <Button
          variant="solid"
          color="primary"
          size="sm"
          disabled={disabled || busy}
          onClick={onVerify}
          dataTestId="domain-verify"
        >
          {copy.records.verifyAction}
        </Button>
      ) : null}
      {/* Confirm-gated: it archives the domain and frees its name, which the popup says. */}
      <ConfirmButton
        variant="outline"
        color="primary"
        size="sm"
        disabled={busy}
        onClick={onRemove}
        confirm={{
          title: copy.records.removeTitle,
          entityName: domainName(domain, copy.pair),
          description: removalConsequence(pending, copy.pair),
          confirmText: copy.records.removeAction,
        }}
        dataTestId="domain-remove"
      >
        {copy.records.removeAction}
      </ConfirmButton>
    </Stack>
  );
}

/**
 * A pair's one-line choice of its principal address, the current one
 * selected. On a pending pair, and on an ACTIVE one too, with one line saying
 * the change applies at once: it flips the redirect, and tapping back undoes
 * it, so no confirmation.
 */
function PrincipalChoice({
  domain,
  busy,
  disabled,
  onPick,
}: {
  domain: TenantDomainItem;
  busy: boolean;
  disabled: boolean;
  onPick: (principal: 'root' | 'www') => void;
}): JSX.Element {
  const { copy, components } = useDomainsScreen();
  const { Segmented } = components;
  const pair = copy.pair;
  const phone = usePhoneCopy();
  const active = domain.status === 'ACTIVE';
  // Said only while the pair answers here: with its DNS elsewhere, no request reaches the redirect yet.
  const saysAtOnce = active && domain.dnsPointsHere !== false;
  return (
    <Stack spacing={0.75} sx={{ maxWidth: '35rem' }} data-testid={active ? 'domain-principal-active' : undefined}>
      <Text variant="caption" size="xs" as="span">
        {pair.principalQuestion}
      </Text>
      <Segmented
        label={pair.principalQuestion}
        value={domain.principal}
        options={[
          { value: 'root', label: phone ? pair.principalRootPhone : domain.hostname },
          { value: 'www', label: phone ? pair.principalWwwPhone : (domain.wwwHostname ?? '') },
        ]}
        disabled={disabled}
        busy={busy}
        dataTestId="domain-principal"
        onPick={onPick}
      />
      {saysAtOnce ? (
        <Text variant="caption" size="xs" as="span" data-testid="domain-principal-change">
          {pair.principalChangeActive}
        </Text>
      ) : null}
    </Stack>
  );
}

/**
 * An active domain's one line: where the tenant answers and what is sent
 * there (the pair's other name, and the platform's address when this is the
 * main domain). Silent while the DNS is known to point elsewhere: the warning
 * says what is true then.
 */
function AnswersLine({ domain }: { domain: TenantDomainItem }): JSX.Element | null {
  const { copy } = useDomainsScreen();
  const pair = copy.pair;
  const phone = usePhoneCopy();
  if (domain.status !== 'ACTIVE' || domain.dnsPointsHere === false) return null;
  const other = domain.wwwHostname === null ? null : domain.principal === 'root' ? domain.wwwHostname : domain.hostname;
  const answers = pair.answersAt(domain.principalHostname);
  const redirects = pair.redirectsFrom(other, domain.canonical);
  const strong = (text: string) => (
    <Text as="span" variant="body" size="sm" weight="semibold">
      {text}
    </Text>
  );
  return (
    <Text variant="body" size="sm" data-testid="domain-answers" style={{ overflowWrap: 'anywhere' }}>
      {answers.before}
      {strong(domain.principalHostname)}
      {answers.after}
      {redirects.before}
      {other === null ? null : phone ? pair.otherNamePhone(domain.principal) : strong(other)}
      {redirects.after}
    </Text>
  );
}

/** The chip may take a second line rather than lose its end; its title carries the words whole as well. */
const STATUS_CHIP_SX = {
  display: 'inline-flex',
  maxWidth: '100%',
  '& .MuiChip-root': { height: 'auto', maxWidth: '100%' },
  '& .MuiChip-label': { whiteSpace: 'normal', overflowWrap: 'anywhere', py: 0.25 },
} as const;

/**
 * The status pill: amber while it waits or does not answer here yet, green
 * once it serves. OUTLINED, not `soft`: the soft chip inks its label with the
 * colour's dark step, which sinks on a night ground; the outline inks it with
 * the colour's main, measured for text on both grounds.
 */
function StatusChip({ domain }: { domain: TenantDomainItem }): JSX.Element {
  const { copy } = useDomainsScreen();
  const serving = domain.status === 'ACTIVE' && domain.dnsPointsHere !== false;
  const label = statusLabelFor(domain, copy.records);
  return (
    <Box component="span" title={label} sx={STATUS_CHIP_SX}>
      <Chip label={label} size="sm" variant="outlined" color={serving ? 'success' : 'warning'} dataTestId="domain-status" />
    </Box>
  );
}

/** The records a row still needs published, and the pointing warning. */
function RowRecords({ domain, dnsTargets }: { domain: TenantDomainItem; dnsTargets: string[] }): JSX.Element {
  const { copy } = useDomainsScreen();
  const pending = domain.status !== 'ACTIVE';
  return (
    <>
      {pending ? <VerificationRecord domain={domain} /> : null}
      {/* The pointing record stays on screen while the name still resolves
          elsewhere: an ACTIVE domain that is not pointed here is exactly the
          one whose owner needs it, and the warning below sends them to it. */}
      {pending || domain.dnsPointsHere === false ? (
        domain.wwwHostname !== null ? (
          <PairPointingRecord domain={domain} dnsTargets={dnsTargets} numbered={pending} />
        ) : (
          <PointingRecord dnsTargets={dnsTargets} hostname={domain.hostname} numbered={pending} copy={copy.records} />
        )
      ) : null}
      <PointingWarning domain={domain} copy={copy.records} />
    </>
  );
}

/** This row's own refused write: where it is told, and how it closes. */
export interface RowRefusalState {
  /** What was refused: the principal is told under its control, anything else above the buttons. */
  kind: 'principal' | 'other';
  message: string;
  testId: string;
  onDismiss: () => void;
}

/** A restored row is brought into view and focused once the list shows it. */
function useReveal(reveal: boolean, onRevealed: () => void) {
  const row = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!reveal) return;
    // Head first (its name and status), the scroll margin above it: on a narrow phone a restored row is taller than the screen.
    row.current?.scrollIntoView?.({ block: 'start' });
    row.current?.focus({ preventScroll: true });
    onRevealed();
  }, [reveal, onRevealed]);
  return row;
}

export function DomainRow({
  domain,
  dnsTargets,
  disabled,
  busy,
  refusal = null,
  reveal = false,
  onRevealed = () => undefined,
  onVerify,
  onPrincipal,
  onRemove,
}: {
  domain: TenantDomainItem;
  dnsTargets: string[];
  disabled: boolean;
  /** THIS domain's write is in flight, never another domain's. */
  busy: boolean;
  refusal?: RowRefusalState | null;
  /** Just restored: scroll it into view and focus it. */
  reveal?: boolean;
  onRevealed?: () => void;
  onVerify: () => void;
  onPrincipal: (principal: 'root' | 'www') => void;
  onRemove: () => Promise<void>;
}): JSX.Element {
  const { copy } = useDomainsScreen();
  const pending = domain.status !== 'ACTIVE';
  const isPair = domain.wwwHostname !== null;
  const row = useReveal(reveal, onRevealed);
  const told = (kind: RowRefusalState['kind']) =>
    refusal !== null && refusal.kind === kind ? (
      <RowRefusal message={refusal.message} testId={refusal.testId} onDismiss={refusal.onDismiss} />
    ) : null;

  return (
    <Box
      ref={row}
      component="section"
      tabIndex={-1}
      aria-label={domainName(domain, copy.pair)}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2, scrollMarginBlock: (theme) => theme.spacing(2) }}
      data-testid="domain-row"
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
          <Text variant="body" size="sm" weight="semibold" as="span" style={{ overflowWrap: 'anywhere' }}>
            {domainName(domain, copy.pair)}
          </Text>
          <StatusChip domain={domain} />
        </Stack>

        {isPair ? <PrincipalChoice domain={domain} busy={busy} disabled={disabled} onPick={onPrincipal} /> : null}
        {told('principal')}
        <RowRecords domain={domain} dnsTargets={dnsTargets} />
        <AnswersLine domain={domain} />

        {told('other')}
        <DomainActions
          domain={domain}
          pending={pending}
          busy={busy}
          disabled={disabled}
          onVerify={onVerify}
          onRemove={onRemove}
        />
      </Stack>
    </Box>
  );
}
