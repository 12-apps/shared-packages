/**
 * The claims already made: each one's state, the records it still needs, and
 * verify / remove, or, with none yet, the address to have ready; then the
 * removed list. The flow the screen has to make obvious: claim a hostname,
 * publish the TXT record shown, point the domain here, verify. A domain does
 * NOT serve until the TXT check passes, because pointing DNS proves nothing
 * about ownership. BOTH halves are on screen: ownership and pointing are
 * independent, and a green status over a dead site is worse than a red one.
 *
 * The writes are the host's (its API, its keyed mutation, its refusal words);
 * the card only routes each refusal to where it is told.
 */
import { useCallback, useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { EmptyState } from '@12-apps/ui/data-display/EmptyState';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import { DomainsScreenProvider, useDomainsScreen, type TenantDomainItem, type TenantDomainsComponents } from './context';
import type { TenantDomainPairCopy, TenantDomainsCopy } from './copy';
import { PointingRecord, domainName } from './records';
import { RemovedList } from './removed';
import { DomainRow, type RowRefusalState } from './row';

/** One write on one domain. `settled` answers after the host's re-read: a restore reveals its row. */
export type TenantDomainWrite<D extends TenantDomainItem> =
  | { kind: 'verify'; domain: D }
  | { kind: 'restore'; domain: D; settled?: (refusal: string | null) => void }
  | { kind: 'principal'; domain: D; principal: 'root' | 'www' };

/** A standing refusal of one domain's write, with the write that was refused. */
export interface TenantDomainRefusal<D extends TenantDomainItem> {
  key: string;
  message: string;
  input: { kind: 'verify' | 'restore' | 'principal' | 'remove'; domain: D };
}

/** The host's writes, ONE PER DOMAIN: their state, a write, and the confirm-gated remove (it rejects with the refusal). */
export interface TenantDomainWrites<D extends TenantDomainItem> {
  writes: {
    errors: readonly TenantDomainRefusal<D>[];
    isPending(id: string): boolean;
    dismiss(id: string): void;
  };
  run(write: TenantDomainWrite<D>): void;
  remove(domain: D): Promise<void>;
}

export interface DomainsCardProps<D extends TenantDomainItem> {
  domains: D[];
  /** The removed (archived) domains. */
  removed: D[];
  dnsTargets: string[];
  disabled: boolean;
  /** The resolved pack for this render. */
  copy: TenantDomainsCopy;
  writes: TenantDomainWrites<D>;
}

/** No domain yet: the invitation, and the address to have ready. */
function NoDomainsYet({ dnsTargets }: { dnsTargets: string[] }): JSX.Element {
  const records = useDomainsScreen().copy.records;
  return (
    <>
      {/* An invitation rather than a statement of absence: the state a tenant
          is in when it arrives on this screen for the first time. */}
      <EmptyState variant="minimal" title={records.emptyTitle} description={records.emptyBody} dataTestId="domains-empty" />
      {/* Unnumbered: with no domain there is no TXT record yet, so this is not
          step 2 of anything; it is the address to have ready. */}
      <PointingRecord dnsTargets={dnsTargets} numbered={false} copy={records} />
    </>
  );
}

/** A refused restore's sentence for this removed domain, or null. */
function restoreRefusalOf<D extends TenantDomainItem>(errors: readonly TenantDomainRefusal<D>[], domain: D): string | null {
  return errors.find((refusal) => refusal.key === domain.id && refusal.input.kind === 'restore')?.message ?? null;
}

/** A live row's own refused write, told in that row. The first refusal on screen is `domains-error`. */
function rowRefusalOf<D extends TenantDomainItem>(writes: TenantDomainWrites<D>['writes'], domain: D): RowRefusalState | null {
  const told = writes.errors.filter((refusal) => refusal.input.kind !== 'restore');
  const at = told.findIndex((refusal) => refusal.key === domain.id);
  const refusal = told[at];
  if (refusal === undefined) return null;
  return {
    kind: refusal.input.kind === 'principal' ? 'principal' : 'other',
    message: refusal.message,
    testId: at === 0 ? 'domains-error' : `domains-error-${refusal.key}`,
    onDismiss: () => writes.dismiss(refusal.key),
  };
}

function CardBody<D extends TenantDomainItem>({ domains, removed, dnsTargets, disabled, writes: host }: DomainsCardProps<D>): JSX.Element {
  const { copy } = useDomainsScreen();
  const { writes, run, remove } = host;
  const [revealed, setRevealed] = useState<string | null>(null);
  const doneRevealing = useCallback(() => setRevealed(null), []);
  // Each refusal is told in its own row; only one whose domain has left the
  // list meanwhile is told at the head, named after it.
  const live = new Set(domains.map((domain) => domain.id));
  const headRefusals = writes.errors.filter((refusal) => refusal.input.kind !== 'restore' && !live.has(refusal.key));

  return (
    <Stack spacing={2} data-testid="domains-card">
      {headRefusals.map((refusal) => (
        <Alert
          key={refusal.key}
          variant="danger"
          // Named after its domain: two rows can be refused at once.
          title={domainName(refusal.input.domain, copy.pair)}
          description={refusal.message}
          closable
          closeLabel={copy.closeAlert}
          onClose={() => writes.dismiss(refusal.key)}
          data-testid={
            writes.errors.find((told) => told.input.kind !== 'restore')?.key === refusal.key
              ? 'domains-error'
              : `domains-error-${refusal.key}`
          }
        />
      ))}

      {domains.length === 0 ? (
        <NoDomainsYet dnsTargets={dnsTargets} />
      ) : (
        domains.map((domain) => (
          <DomainRow
            key={domain.id}
            domain={domain}
            dnsTargets={dnsTargets}
            disabled={disabled}
            busy={writes.isPending(domain.id)}
            refusal={rowRefusalOf(writes, domain)}
            reveal={revealed === domain.id}
            onRevealed={doneRevealing}
            onVerify={() => run({ kind: 'verify', domain })}
            onPrincipal={(principal) => run({ kind: 'principal', domain, principal })}
            onRemove={() => remove(domain)}
          />
        ))
      )}

      <RemovedList
        removed={removed}
        isBusy={(domain) => disabled || writes.isPending(domain.id)}
        refusalOf={(domain) => restoreRefusalOf(writes.errors, domain)}
        onDismissRefusal={(domain) => writes.dismiss(domain.id)}
        onRestore={(domain) =>
          run({ kind: 'restore', domain, settled: (refusal) => refusal === null && setRevealed(domain.id) })
        }
      />
    </Stack>
  );
}

/** The card, its pack and the host's widgets provided to every part. */
export function makeDomainsCard(components: TenantDomainsComponents) {
  return function DomainsCard<D extends TenantDomainItem>(props: DomainsCardProps<D>): JSX.Element {
    return (
      <DomainsScreenProvider value={{ copy: props.copy, components }}>
        <CardBody {...props} />
      </DomainsScreenProvider>
    );
  };
}

/** Under the claim field, before saving, when the typed address is a root domain: it is claimed with its `www.`. */
export function PairAnnouncement({
  root,
  www,
  copy,
}: {
  root: string;
  www: string;
  copy: Pick<TenantDomainPairCopy, 'pairAnnouncement'>;
}): JSX.Element {
  const words = copy.pairAnnouncement(root, www);
  const strong = (text: string) => (
    <Text as="span" variant="body" size="sm" weight="semibold">
      {text}
    </Text>
  );
  return (
    <Box
      sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 1.5, py: 1.25, maxWidth: '40rem' }}
      data-testid="domain-pair-announcement"
    >
      <Text variant="body" size="sm" style={{ overflowWrap: 'anywhere' }}>
        {words.before}
        {strong(root)}
        {words.and}
        {strong(www)}
        {words.after}
      </Text>
    </Box>
  );
}
