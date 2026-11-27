/**
 * What a person has to publish, and what each state means: the DNS side of
 * the screen. The exact records to paste into a registrar, the word for each
 * stored status, and the warning for the one state that looks like success
 * and is not (verified, ACTIVE, and the name still resolves somewhere else).
 * Keeping both records in one file is what keeps them from drifting apart.
 */
import { useRef, useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Button } from '@12-apps/ui/form/Button';
import { Input } from '@12-apps/ui/form/Input';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import { dnsZoneOf, isZoneApex, pointingRecordType, relativeDnsName } from '../dns-names';
import { usePhoneCopy, useDomainsScreen, type TenantDomainItem } from './context';
import type { TenantDomainPairCopy, TenantDomainRecordsCopy } from './copy';

export { pointingRecordType, type PointingRecordType } from '../dns-names';

/** The word per stored status: the raw enum never reaches the person; the keys stay the wire's. */
function statusLabels(copy: TenantDomainRecordsCopy): Record<string, string> {
  return {
    PENDING: copy.awaitingVerification,
    VERIFIED: copy.verified,
    ACTIVE: copy.active,
    DISABLED: copy.disabled,
    FAILED: copy.verificationFailed,
  };
}

/**
 * The status line, which must not claim more than is known. "Active" alone
 * means "this address serves the tenant", true only when the name also
 * resolves here: `dnsPointsHere === false` is the one case known not to;
 * `null` is unknown and stays silent.
 */
export function statusLabelFor(
  domain: Pick<TenantDomainItem, 'status' | 'dnsPointsHere'>,
  copy: TenantDomainRecordsCopy,
): string {
  const base = statusLabels(copy)[domain.status] ?? domain.status;
  if (domain.status !== 'ACTIVE') return base;
  return domain.dnsPointsHere === false ? copy.dnsNotHereYet(base) : base;
}

/** A domain's name on its card: a pair is its root `+ www`, as the host's pack writes it. */
export function domainName(
  domain: Pick<TenantDomainItem, 'hostname' | 'wwwHostname'>,
  pair: Pick<TenantDomainPairCopy, 'pairName'>,
): string {
  return domain.wwwHostname === null ? domain.hostname : pair.pairName(domain.hostname);
}

/**
 * One record value, read-only, and its copy button. A long value (the TXT
 * token) is cut on a phone, so one tap copies it whole; it says so for a
 * moment. Where the browser gives no clipboard or refuses the write, the tap
 * selects the field's text instead, to copy by hand.
 */
function RecordValue({
  value,
  label,
  copy,
  testId,
}: {
  value: string;
  label: string;
  copy: TenantDomainRecordsCopy;
  testId: string;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLDivElement>(null);
  const selectField = () => {
    const input = field.current?.querySelector('input');
    input?.focus();
    input?.select();
  };
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
      <Box ref={field} sx={{ flex: '1 1 0', minWidth: 0 }}>
        <Input size="sm" fullWidth readOnly label={label} value={value} title={value} data-testid={testId} />
      </Box>
      <Button
        variant="outline"
        color="primary"
        size="sm"
        onClick={() => {
          if (typeof navigator.clipboard?.writeText !== 'function') return selectField();
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          }, selectField);
        }}
        aria-label={copy.copyValueLabel(value)}
        dataTestId="domain-record-copy"
      >
        {copied ? copy.copiedValue : copy.copyValue}
      </Button>
    </Stack>
  );
}

/**
 * One record as a provider's form asks for it: type, name, value, each a
 * read-only field to copy. The name is RELATIVE to the zone (`@`, `shop`, the
 * TXT prefix); the full name stays one line below for providers that want it.
 */
function DnsRecord({
  copy,
  type,
  name,
  values,
  fqdn,
  valueLabel,
  testId,
}: {
  copy: TenantDomainRecordsCopy;
  type: string;
  name: string;
  values: string[];
  /** The full name, shown as a fallback when it differs from `name`. */
  fqdn?: string;
  /** The value field's label when the plain one would not say which record it is. */
  valueLabel?: string;
  /** Prefix of the name (`-name`) and value (`-value`) fields' test ids. */
  testId: string;
}): JSX.Element {
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
        <Box sx={{ flex: '0 0 4.5rem' }}>
          <Input size="sm" fullWidth readOnly label={copy.recordType} value={type} />
        </Box>
        <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
          <Input size="sm" fullWidth readOnly label={copy.recordName} value={name} data-testid={`${testId}-name`} />
        </Box>
      </Stack>
      {values.map((value) => (
        <RecordValue key={value} value={value} label={valueLabel ?? copy.recordValue} copy={copy} testId={`${testId}-value`} />
      ))}
      {fqdn !== undefined && fqdn !== name ? (
        <Text variant="caption" size="xs" style={{ overflowWrap: 'anywhere' }}>
          {copy.fullNameFallback(fqdn)}
        </Text>
      ) : null}
    </Stack>
  );
}

/** The TXT record to publish before a domain can serve. A pair's one record, at the root, proves both names. */
export function VerificationRecord({ domain }: { domain: TenantDomainItem }): JSX.Element {
  const { copy: pack } = useDomainsScreen();
  const copy = pack.records;
  const phone = usePhoneCopy();
  const step = domain.wwwHostname === null ? copy.txtStep : phone ? pack.pair.txtStepPairPhone : pack.pair.txtStepPair;
  return (
    <Stack spacing={1}>
      <Text variant="caption" size="xs">
        {step}
      </Text>
      <DnsRecord
        copy={copy}
        type="TXT"
        name={relativeDnsName(domain.recordName, domain.hostname)}
        values={domain.dnsRecords.verification.values}
        fqdn={domain.recordName}
        testId="domain-record"
      />
    </Stack>
  );
}

/**
 * Step 2 for a root + `www` pair: both names point here, a record for `@` and
 * one for `www`, as the server built them, then the advice to delete the old
 * site's records. Nothing when the deploy does not know its address.
 */
export function PairPointingRecord({
  domain,
  dnsTargets,
  numbered,
}: {
  domain: TenantDomainItem;
  dnsTargets: string[];
  /** Step 2 of a pending pair; unnumbered when no step 1 is on screen (ACTIVE, pointing elsewhere). */
  numbered: boolean;
}): JSX.Element | null {
  const { copy: pack } = useDomainsScreen();
  const phone = usePhoneCopy();
  const { pointing } = domain.dnsRecords;
  if (dnsTargets.length === 0 || pointing.length === 0) return null;
  const several = new Set(pointing.map((record) => record.type)).size > 1;
  return (
    <Stack spacing={1} data-testid="domain-dns-target">
      <Text variant="caption" size="xs">
        {numbered ? '2. ' : ''}
        {pack.pair.pointBothNames}
      </Text>
      {pointing.map((record) => (
        <DnsRecord
          key={`${record.type}-${record.name}`}
          copy={pack.records}
          type={record.type}
          name={record.name}
          values={record.values}
          valueLabel={several ? pack.records.recordLabel(record.type) : undefined}
          testId="domain-dns-target"
        />
      ))}
      <Text variant="caption" size="xs" data-testid="domain-dns-replace">
        {phone ? pack.pair.replaceOldRecordsPhone : pack.pair.replaceOldRecords}
      </Text>
    </Stack>
  );
}

/**
 * Both kinds of address, every time. A main domain usually still carries the
 * old site's A records, which keep answering beside ours unless deleted; a
 * subdomain is more often a CNAME, which a provider refuses to keep beside an
 * A record. The row's own kind goes first, marked; the other kind is an
 * offer, never an instruction, because telling a subdomain's owner to delete
 * the main domain's A records takes their main site down.
 */
function DnsKindGuide({ copy, hostname }: { copy: TenantDomainRecordsCopy; hostname?: string }): JSX.Element {
  // No row yet: the field's own placeholder is the example.
  const example = hostname ?? copy.placeholder;
  const zone = dnsZoneOf(example);
  const apex = isZoneApex(example);
  const subdomain = apex ? `${copy.placeholder.split('.')[0]}.${zone}` : example;
  const label = relativeDnsName(subdomain, subdomain);
  // With no row yet both are instructions; with one, only the row's own kind is.
  const teaches = (mine: boolean): boolean => hostname === undefined || mine;
  const kinds = [
    {
      key: 'apex',
      title: copy.kindApex,
      mine: hostname !== undefined && apex,
      text: teaches(hostname !== undefined && apex) ? copy.apexGuide(zone) : copy.otherApexGuide(zone),
    },
    {
      key: 'subdomain',
      title: copy.kindSubdomain,
      mine: hostname !== undefined && !apex,
      text: teaches(hostname !== undefined && !apex)
        ? copy.subdomainGuide(subdomain, label)
        : copy.otherSubdomainGuide(subdomain, label),
    },
  ].sort((left, right) => Number(right.mine) - Number(left.mine));
  return (
    <Stack spacing={0.5} data-testid="domain-dns-kinds">
      {kinds.map((kind) => (
        <Text
          key={kind.key}
          variant="caption"
          size="xs"
          // A long name has no break point but its dots.
          style={{ overflowWrap: 'anywhere' }}
          data-testid={`domain-dns-kind-${kind.key}`}
        >
          <Text as="span" variant="caption" size="xs" weight="semibold">
            {kind.mine ? `${kind.title} (${copy.yourCase})` : kind.title}
          </Text>
          {` — ${kind.text}`}
        </Text>
      ))}
    </Stack>
  );
}

/**
 * Where to point the domain, with the same copy-and-paste treatment as the
 * TXT record: they are two steps of one job. Shown even with no domain yet,
 * when somebody is about to configure DNS. Nothing when the deploy does not
 * know its own address, rather than an empty field that reads as broken.
 */
export function PointingRecord({
  dnsTargets,
  hostname,
  numbered,
  copy,
}: {
  dnsTargets: string[];
  /** The domain being pointed; absent in the empty state. */
  hostname?: string;
  numbered: boolean;
  copy: TenantDomainRecordsCopy;
}): JSX.Element | null {
  if (dnsTargets.length === 0) return null;
  const types = dnsTargets.map(pointingRecordType);
  const single = types.length === 1 ? types[0] : undefined;
  // One record per type, in the deploy's order: an A with its IPv4s, an AAAA with its IPv6s.
  const groups = [...new Set(types)].map((type) => [type, dnsTargets.filter((_, at) => types[at] === type)] as const);
  return (
    <Stack spacing={1} data-testid="domain-dns-target">
      <Text variant="caption" size="xs">
        {numbered ? '2. ' : ''}
        {single ? copy.pointWithRecord(single) : copy.pointWithRecords}
      </Text>
      {groups.map(([type, values], index) => (
        <DnsRecord
          key={type}
          copy={copy}
          type={type}
          name={hostname === undefined ? '@' : relativeDnsName(hostname, hostname)}
          values={values}
          // Two record types share one name: say the full name once.
          fqdn={index === 0 ? hostname : undefined}
          // With A and AAAA side by side, each value names its record.
          valueLabel={single ? undefined : copy.recordLabel(type)}
          testId="domain-dns-target"
        />
      ))}
      <DnsKindGuide copy={copy} hostname={hostname} />
    </Stack>
  );
}

/**
 * The advisory that closes the loop: ownership is proven, the address is not
 * pointed here. Deliberately NOT an error: the domain is legitimately verified
 * and ACTIVE, with one step left in somebody else's control panel.
 */
export function PointingWarning({
  domain,
  copy,
}: {
  domain: Pick<TenantDomainItem, 'dnsPointsHere'>;
  copy: TenantDomainRecordsCopy;
}): JSX.Element | null {
  if (domain.dnsPointsHere !== false) return null;
  return (
    <Alert variant="warning" data-testid="domain-not-pointed">
      {copy.notPointedWarning}
    </Alert>
  );
}

/**
 * What removing this domain costs. A removal archives the domain and frees its
 * name, so both cases say it can be restored while nobody takes the name. A
 * PENDING one never served; an ACTIVE one is the address people bookmarked,
 * and getting it back means verifying the DNS again.
 */
export function removalConsequence(
  pending: boolean,
  copy: { removeFromList: string; removeConsequence: string },
): string {
  return pending ? copy.removeFromList : copy.removeConsequence;
}
