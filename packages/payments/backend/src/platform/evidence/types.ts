import type { RecordedHttpCall } from '../../core/traffic-recorder';
import type { WalletType } from '../../core/wallet-types';

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

/**
 * The file's sections, in the order (and so with the numbers, from 2) it
 * prints them. DEBIT came last (FUT-3755) so the card steps PagBank already
 * cites — 4.6 among them — keep their numbers; the two wallets came after it
 * for the same reason.
 */
export const EVIDENCE_SECTIONS = ['CONNECT', 'PIX', 'CARD', 'DEBIT', 'GOOGLE_PAY', 'APPLE_PAY'] as const;

export type EvidenceSection = (typeof EVIDENCE_SECTIONS)[number];

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
  'debit.session',
  'debit.authenticate',
  'debit.approved',
  'debit.consult',
  'debit.cancel',
  'gpay.token',
  'gpay.approved',
  'gpay.consult',
  'gpay.cancel',
  'apay.token',
  'apay.approved',
  'apay.consult',
  'apay.cancel',
] as const;

export type EvidenceStepKey = (typeof EVIDENCE_STEP_KEYS)[number];

/** A key's prefix names its section: `debit.session` is DEBIT. */
const SECTION_BY_PREFIX: Readonly<Record<string, EvidenceSection>> = {
  connect: 'CONNECT',
  pix: 'PIX',
  card: 'CARD',
  debit: 'DEBIT',
  gpay: 'GOOGLE_PAY',
  apay: 'APPLE_PAY',
};

export const SECTION_OF: Readonly<Record<EvidenceStepKey, EvidenceSection>> = Object.fromEntries(
  EVIDENCE_STEP_KEYS.map((key) => [key, SECTION_BY_PREFIX[key.split('.')[0]!]!]),
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

/** Which official test card a browser result is about. */
export const BROWSER_CARD_SCENARIOS = ['approved', 'declined', 'debit'] as const;
export type BrowserCardScenario = (typeof BROWSER_CARD_SCENARIOS)[number];

/** One official test card, as the browser reports it. Never a PAN. */
export interface BrowserCardResult {
  scenario: BrowserCardScenario;
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
  /**
   * The debit card only (FUT-3755): the id PagBank's `authenticate3DS`
   * answered, which the DEBIT_CARD order carries as `authentication_method`.
   * Absent when the authentication did not complete — `failure` says why.
   */
  authenticationId?: string;
  /** Whether the issuer AUTHENTICATED the cardholder (the 3DS test card's expected answer). */
  authenticated?: boolean;
}

export const BROWSER_CARD_FAILURES = [
  'SDK_UNAVAILABLE',
  'NOT_PROCESSED',
  'NO_PUBLIC_KEY',
  'NO_THREEDS_SESSION',
  'THREEDS_NOT_SUPPORTED',
  'THREEDS_REFUSED',
  'THREEDS_FAILED',
] as const;
export type BrowserCardFailure = (typeof BROWSER_CARD_FAILURES)[number];

/** The wallets the evidence runs, in the order the file prints them (FUT-3755). */
export const EVIDENCE_WALLETS = ['GOOGLE_PAY', 'APPLE_PAY'] as const satisfies readonly WalletType[];
export type EvidenceWallet = (typeof EVIDENCE_WALLETS)[number];

/**
 * Why the browser has no wallet token — a CODE, worded by the evidence copy:
 *
 * - `NOT_AVAILABLE`              this browser/device cannot show the wallet's sheet
 * - `DISMISSED`                  the operator closed the sheet
 * - `NOT_CONFIGURED`             the host has no Apple Pay identity (no Apple Developer account yet)
 * - `MERCHANT_VALIDATION_FAILED` Apple Pay's merchant validation did not complete
 * - `TOKEN_ERROR`                the sheet failed, or answered without a token
 */
export const BROWSER_WALLET_FAILURES = [
  'NOT_AVAILABLE',
  'DISMISSED',
  'NOT_CONFIGURED',
  'MERCHANT_VALIDATION_FAILED',
  'TOKEN_ERROR',
] as const;
export type BrowserWalletFailure = (typeof BROWSER_WALLET_FAILURES)[number];

/**
 * One wallet's sheet, as the browser reports it to phase 2 (FUT-3755). The
 * token is the wallet's one-time payment credential, sent verbatim as
 * `card.wallet.key` and redacted wherever it is recorded; `brand` and `last4`
 * are what the wallet itself showed (never a PAN).
 */
export interface BrowserWalletResult {
  type: EvidenceWallet;
  /** Google's `tokenizationData.token`, or Apple's `token.paymentData` serialized; null when there is none. */
  token: string | null;
  /** The card network the wallet named, e.g. `VISA`; null when it named none. */
  brand: string | null;
  /** The card's last four digits as the wallet showed them; null when it showed none. */
  last4: string | null;
  /** Why there is no token. */
  failure?: BrowserWalletFailure;
}

/**
 * What the browser needs to open each wallet's sheet for the evidence —
 * computed server-side (FUT-3755). Google Pay is always `TEST` (the evidence is
 * sandbox-only) and is minted against the test seller's PagBank account id;
 * Apple Pay only says whether the host has an Apple Pay identity at all.
 */
export interface EvidenceWalletsConfig {
  /** The amount the sheets show — the amount the wallet orders are raised for. */
  amountCents: number;
  googlePay: { gateway: string; gatewayMerchantId: string; environment: 'TEST' } | null;
  applePay: { configured: boolean };
}

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
  threeDSSessionMinted: string;
  threeDSSessionMissing: string;
  /** The browser's 3DS answer: an authentication id, AUTHENTICATED or not. */
  threeDSAuthenticated: (authenticated: boolean) => string;
  /** The 3DS authentication did not complete; `detail` is a worded browser failure. */
  threeDSFailed: (detail: string) => string;
  /** The browser reported no debit card at all. */
  debitNotReported: string;
  /** Each wallet's name as the file prints it (FUT-3755). */
  walletNames: Readonly<Record<EvidenceWallet, string>>;
  /** The browser obtained the wallet's token; `card` is its network and last four. */
  walletTokenReceived: (wallet: string, card: string) => string;
  /** The wallet's button was not pressed before generating. */
  walletNotRun: (wallet: string) => string;
  /** The browser has no token; `detail` is a worded {@link BrowserWalletFailure}. */
  walletFailed: (wallet: string, detail: string) => string;
  walletFailures: Readonly<Record<BrowserWalletFailure, string>>;
  /** The host has no Apple Pay identity: waiting for the Apple Developer account. */
  applePayNotConfigured: string;
  webhookReceived: (count: number, inboxStatuses: string, chargeStatus: string | null) => string;
  webhookNone: string;
  webhookFailed: string;
  webhookNotProcessed: (inboxStatuses: string, chargeStatus: string | null) => string;
  enableFailed: (detail: string) => string;
}
