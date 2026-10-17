import type { RecordedHttpCall } from '../../core/traffic-recorder';

/**
 * The homologação EVIDENCE model (FUT-3696) — what was really executed against
 * the PagBank sandbox, step by step, in the shape PagBank's reviewer reads.
 *
 * Every step is one of three things and nothing else: executed (it ran and the
 * response matched what the scenario expects), failed (it ran and did not), or
 * pending (it did not run, or its outcome is not known yet). There is no
 * "simulated" state on purpose: a step whose call never happened stays
 * PENDING with the reason, so the file can never present a mock as evidence.
 *
 * Browser-safe: types only. The recording itself is server-only and lives
 * behind the `./homologacao-evidence` subpath.
 */

export type EvidenceStatus = 'EXECUTED' | 'FAILED' | 'PENDING';

export type EvidenceSection = 'CONNECT' | 'PIX' | 'CARD';

/** Every scenario the file reports, in the order it reports them. */
export const EVIDENCE_STEP_KEYS = [
  'connect.authorize',
  'connect.callback',
  'connect.exchange',
  'connect.application',
  'connect.refresh',
  'connect.usage',
  'pix.create',
  'pix.consult',
  'pix.paid',
  'pix.webhook',
  'card.publicKey',
  'card.encrypt',
  'card.approved',
  'card.approvedConsult',
  'card.declined',
  'card.cancel',
  'card.webhook',
] as const;

export type EvidenceStepKey = (typeof EVIDENCE_STEP_KEYS)[number];

export const SECTION_OF: Readonly<Record<EvidenceStepKey, EvidenceSection>> = Object.fromEntries(
  EVIDENCE_STEP_KEYS.map((key) => [
    key,
    key.startsWith('connect.') ? 'CONNECT' : key.startsWith('pix.') ? 'PIX' : 'CARD',
  ]),
) as Record<EvidenceStepKey, EvidenceSection>;

/** One scenario's outcome, with every call it made (already redacted). */
export interface EvidenceStep {
  key: EvidenceStepKey;
  status: EvidenceStatus;
  /** When the step ran, ISO-8601 UTC; null when it never ran. */
  at: string | null;
  calls: RecordedHttpCall[];
  /** Facts that are not an HTTP call of ours — a browser action, a callback. */
  notes: string[];
  /** Provider ids the reader correlates across steps (order, charge, QR). */
  ids: Record<string, string>;
  /**
   * What actually happened, in the copy's words. The CONCLUSION is not
   * stored: it is derived from `status` when the file is rendered, so the two
   * can never disagree.
   */
  observed: string;
}

/** CONNECT holds the seller's authorization; RUN holds one evidence run. */
export type EvidenceRecordKind = 'CONNECT' | 'RUN';

export interface EvidenceRecord {
  id: string;
  provider: string;
  kind: EvidenceRecordKind;
  createdAt: string;
  updatedAt: string;
  steps: EvidenceStep[];
}

/** Where evidence lives — the host supplies the persistence, tests use memory. */
export interface HomologacaoEvidenceStore {
  /** The most recently created record of a kind, or null. */
  latest(provider: string, kind: EvidenceRecordKind): Promise<EvidenceRecord | null>;
  /** Insert-or-replace by `record.id`. */
  save(record: EvidenceRecord): Promise<EvidenceRecord>;
}

/** One stored webhook delivery, as the host's inbox holds it. */
export interface EvidenceWebhookEvent {
  receivedAt: Date;
  processedAt: Date | null;
  /** The inbox status: PENDING | PROCESSED | FAILED. */
  status: string;
  payload: unknown;
}

/** The charge row a delivery moved, as the host's charge table holds it. */
export interface EvidenceChargeRow {
  providerChargeId: string;
  status: string;
  updatedAt: Date;
}

/** One official test card, as the browser reports it. Never a PAN. */
export interface BrowserCardResult {
  scenario: 'approved' | 'declined';
  brand: string;
  /** The number as the reader may see it, e.g. `4539 62** **** 2097`. */
  masked: string;
  /** `PagSeguro.encryptCard`'s output, or null when encryption failed. */
  encrypted: string | null;
  /**
   * Why there is no blob — a CODE, worded by the evidence copy, so the file
   * stays in its reader's language whatever the operator's screen is in.
   */
  failure?: BrowserCardFailure;
}

export const BROWSER_CARD_FAILURES = ['SDK_UNAVAILABLE', 'NOT_PROCESSED', 'NO_PUBLIC_KEY'] as const;
export type BrowserCardFailure = (typeof BROWSER_CARD_FAILURES)[number];

/** The ✓/✗/⧗ counts the screen shows beside the button. */
export interface EvidenceSummary {
  executed: number;
  failed: number;
  pending: number;
}

/**
 * Every sentence the evidence file and its steps are written in. Required
 * config, like every copy port here; `PT_BR_HOMOLOGACAO_EVIDENCE_COPY` is the
 * pack — and the only sensible one, because the reader is PagBank's reviewer.
 */
export interface HomologacaoEvidenceCopy {
  title: string;
  statusLabels: Readonly<Record<EvidenceStatus, string>>;
  sectionTitles: Readonly<Record<EvidenceSection, string>>;
  steps: Readonly<Record<EvidenceStepKey, { scenario: string; expected: string }>>;
  identification: {
    heading: string;
    name: string;
    site: string;
    environment: string;
    testsAt: string;
    /** The two moments the tests ran: the seller's authorization, and the orders. */
    testsAtConnect: string;
    testsAtRun: string;
    /** The file's verdict at the top, so a reader sees "incomplete" before the index. */
    situation: (summary: EvidenceSummary) => string;
    clientId: string;
    callback: string;
    generatedAt: string;
    notRun: string;
  };
  labels: {
    index: string;
    scenario: string;
    status: string;
    time: string;
    notes: string;
    request: string;
    response: string;
    httpStatus: string;
    noResponse: (error: string) => string;
    ids: string;
    expected: string;
    observed: string;
    conclusion: string;
    noCalls: string;
    /** A scenario that did not run: no call was recorded, which is not "no call needed". */
    noCallsPending: string;
  };
  redactionNote: string;
  pendencies: {
    heading: string;
    incomplete: (failed: number, pending: number) => string;
    allExecuted: string;
    notCovered: readonly string[];
    noGuarantee: string;
  };
  outcome: EvidenceOutcomeCopy;
}

/** The observed/conclusion sentences the recording writes into each step. */
export interface EvidenceOutcomeCopy {
  notRun: string;
  asExpected: string;
  notAsExpected: string;
  awaitingConsent: (authorizeUrl: string) => string;
  consentGiven: string;
  consentRefused: (error: string) => string;
  callbackReceived: (stateMatched: boolean) => string;
  /** The callback came back without a code: the provider's error, if it named one. */
  callbackWithoutCode: (error: string | null) => string;
  callbackStateMismatch: string;
  callError: (detail: string) => string;
  httpAnswered: (status: number) => string;
  exchangeStored: (accountId: string | null) => string;
  applicationConsulted: string;
  applicationRedirectMismatch: string;
  refreshed: string;
  refreshRejected: string;
  usageSellerToken: (calls: number, seller: string, platform: string | null) => string;
  usageOtherToken: string;
  usageSameAsPlatform: string;
  usageNotConnected: string;
  notSandbox: string;
  qrCreated: (orderId: string) => string;
  qrMissing: string;
  consultStatus: (status: string, polls: number) => string;
  paid: string;
  notPaidYet: (seconds: number) => string;
  publicKeyMinted: string;
  publicKeyMissing: string;
  encrypted: (cards: string) => string;
  encryptFailed: (detail: string) => string;
  browserFailures: Readonly<Record<BrowserCardFailure, string>>;
  chargeStatus: (status: string) => string;
  canceled: (status: string) => string;
  webhookReceived: (count: number, inboxStatuses: string, chargeStatus: string | null) => string;
  webhookNone: string;
  webhookFailed: string;
  webhookNotProcessed: (inboxStatuses: string, chargeStatus: string | null) => string;
  enableFailed: (detail: string) => string;
}
