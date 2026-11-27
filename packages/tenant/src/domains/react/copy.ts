/**
 * The words of the custom-domains screen: ALL of them are the host's. The
 * package names each key and its kind (`text`, or `sentence`: a function that
 * writes the whole sentence, so a language's grammar stays the host's), and
 * `createDomainsScreen` refuses a pack missing one.
 *
 * Two groups on purpose: both say "remove from the list" and "what removing
 * costs", in different words, and the row uses the PAIR's. Flattening them
 * would silently swap sentences.
 */

/** The records, the statuses, the empty state and the row's own buttons. */
export interface TenantDomainRecordsCopy {
  readonly awaitingVerification: string;
  readonly verificationFailed: string;
  readonly verified: string;
  readonly active: string;
  readonly disabled: string;
  /** An ACTIVE domain whose DNS answers elsewhere: the status word, qualified. */
  dnsNotHereYet(base: string): string;
  /** The removal confirmation's title. */
  readonly removeTitle: string;
  /** The field's placeholder, also the example address of the empty state. */
  readonly placeholder: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly recordType: string;
  readonly recordName: string;
  readonly recordValue: string;
  /** Step 1 for a lone subdomain: the TXT record. */
  readonly txtStep: string;
  readonly kindApex: string;
  readonly kindSubdomain: string;
  /** Marks the kind the row's own address is. */
  readonly yourCase: string;
  apexGuide(example: string): string;
  subdomainGuide(example: string, label: string): string;
  /** The kind the row is NOT: an offer, never an order. */
  otherApexGuide(example: string): string;
  otherSubdomainGuide(example: string, label: string): string;
  fullNameFallback(fqdn: string): string;
  pointWithRecord(recordType: string): string;
  readonly pointWithRecords: string;
  recordLabel(recordType: string): string;
  readonly notPointedWarning: string;
  readonly copyValue: string;
  readonly copiedValue: string;
  copyValueLabel(value: string): string;
  /** The verify button. */
  readonly verifyAction: string;
  /** The remove button, and its confirmation's button. */
  readonly removeAction: string;
}

/** The root + `www` pair, the principal address and the removed list. */
export interface TenantDomainPairCopy {
  pairAnnouncement(root: string, www: string): { before: string; and: string; after: string };
  pairName(root: string): string;
  readonly principalQuestion: string;
  readonly principalRootPhone: string;
  readonly principalWwwPhone: string;
  readonly principalChangeActive: string;
  readonly txtStepPair: string;
  readonly txtStepPairPhone: string;
  readonly pointBothNames: string;
  readonly replaceOldRecords: string;
  readonly replaceOldRecordsPhone: string;
  answersAt(principal: string): { before: string; after: string };
  redirectsFrom(other: string | null, platform: boolean): { before: string; after: string };
  otherNamePhone(principal: 'root' | 'www'): string;
  removedTitle(count: number): string;
  removedLine(date: string, by: string | null): string;
  readonly restore: string;
  /** The language the removal date is written in (a BCP 47 tag). */
  readonly locale: string;
  readonly removeFromList: string;
  readonly removeConsequence: string;
}

/** One language's pack for the screen. */
export interface TenantDomainsCopy {
  records: TenantDomainRecordsCopy;
  pair: TenantDomainPairCopy;
  /** The accessible name of an alert's close button. */
  closeAlert: string;
}

type Kind = 'text' | 'sentence';

export const TENANT_DOMAINS_COPY_SHAPE = {
  records: {
    awaitingVerification: 'text',
    verificationFailed: 'text',
    verified: 'text',
    active: 'text',
    disabled: 'text',
    dnsNotHereYet: 'sentence',
    removeTitle: 'text',
    placeholder: 'text',
    emptyTitle: 'text',
    emptyBody: 'text',
    recordType: 'text',
    recordName: 'text',
    recordValue: 'text',
    txtStep: 'text',
    kindApex: 'text',
    kindSubdomain: 'text',
    yourCase: 'text',
    apexGuide: 'sentence',
    subdomainGuide: 'sentence',
    otherApexGuide: 'sentence',
    otherSubdomainGuide: 'sentence',
    fullNameFallback: 'sentence',
    pointWithRecord: 'sentence',
    pointWithRecords: 'text',
    recordLabel: 'sentence',
    notPointedWarning: 'text',
    copyValue: 'text',
    copiedValue: 'text',
    copyValueLabel: 'sentence',
    verifyAction: 'text',
    removeAction: 'text',
  },
  pair: {
    pairAnnouncement: 'sentence',
    pairName: 'sentence',
    principalQuestion: 'text',
    principalRootPhone: 'text',
    principalWwwPhone: 'text',
    principalChangeActive: 'text',
    txtStepPair: 'text',
    txtStepPairPhone: 'text',
    pointBothNames: 'text',
    replaceOldRecords: 'text',
    replaceOldRecordsPhone: 'text',
    answersAt: 'sentence',
    redirectsFrom: 'sentence',
    otherNamePhone: 'sentence',
    removedTitle: 'sentence',
    removedLine: 'sentence',
    restore: 'text',
    locale: 'text',
    removeFromList: 'text',
    removeConsequence: 'text',
  },
  closeAlert: 'text',
} as const satisfies {
  records: { [K in keyof TenantDomainRecordsCopy]-?: Kind };
  pair: { [K in keyof TenantDomainPairCopy]-?: Kind };
  closeAlert: Kind;
};
