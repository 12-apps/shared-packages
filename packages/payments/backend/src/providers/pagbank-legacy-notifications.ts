import { ProviderRequestError } from '../core/errors';
import type {
  ChargeSnapshot,
  NormalizedWebhookEvent,
  PaymentMethodKind,
  ResolvedCredentials,
} from '../core/types';
import { NAME } from './pagbank-http';
import { sha256Hex } from './shared';

/**
 * FUT-477, second half — RESOLVE a legacy `notificationCode` delivery.
 *
 * `pagbank-webhook.ts` recognizes the form-encoded post-transaction shape and
 * parks it as an UNKNOWN event whose `raw` keeps the code; this module is the
 * follow-up query those rows exist to feed. The documented lookup lives on the
 * LEGACY PagSeguro host and answers in XML:
 *
 *   GET https://ws.pagseguro.uol.com.br/v3/transactions/notifications/{code}
 *       ?email={email_conta}&token={token_api}
 *
 * The events returned use the same normalized vocabulary as `webhook.parse`,
 * so a host applies them with the machinery it already has. The contract per
 * resolved transaction status (PagSeguro's documented codes):
 *
 *   | status | meaning              | events emitted                          |
 *   |--------|----------------------|-----------------------------------------|
 *   | 1, 2   | awaiting / analysis  | CHARGE_UPDATED (PENDING)                 |
 *   | 3      | paid                 | CHARGE_UPDATED (PAID)                    |
 *   | 4      | available (settled)  | CHARGE_UPDATED (PAID)                    |
 *   | 5, 9   | in dispute           | DISPUTE_UPDATED (no snapshot — held)     |
 *   | 6      | returned (refund)    | CHARGE_UPDATED (REFUNDED) + REFUND_UPDATED |
 *   | 8      | chargeback debited   | CHARGE_UPDATED (REFUNDED) + REFUND_UPDATED |
 *   | 7      | canceled             | CHARGE_UPDATED (CANCELED)                |
 *   | other  | unpublished code     | UNKNOWN (raw preserved)                  |
 *
 * A chargeback (6/8) therefore always yields a CHARGE_UPDATED whose snapshot
 * is REFUNDED and names the host `reference` — the event a host acts on to
 * take the order out of PAID — plus the REFUND_UPDATED ledger fact. Every
 * event's `raw` is the parsed {@link PagbankLegacyNotificationDetail}.
 *
 * Correlation is BY REFERENCE, deliberately: the legacy transaction `<code>`
 * is not an Orders-API charge id, so no stored charge row is keyed by it —
 * `providerChargeId` carries it for audit, and hosts resolve the order through
 * `reference` (which is the `reference_id` the charge was created under).
 *
 * Stateless like every adapter surface: the credential pair arrives per call
 * and is never cached. It is the LEGACY pair — the account e-mail plus the
 * account (API) token, NOT a Connect access token, which the legacy host does
 * not accept. Read from `legacyEmail`/`legacyToken` when the host stores them
 * apart, falling back to `email`/`token`.
 */

const LEGACY_HOSTS = {
  PRODUCTION: 'https://ws.pagseguro.uol.com.br',
  SANDBOX: 'https://ws.sandbox.pagseguro.uol.com.br',
} as const;

/** What a resolved legacy notification says — every event's `raw` payload. */
export interface PagbankLegacyNotificationDetail {
  /** The code the form-encoded delivery carried — the lookup key. */
  notificationCode: string;
  /** The LEGACY transaction code (`<code>`) — not an Orders-API charge id. */
  transactionCode: string;
  /** The host reference the charge was created under (`<reference>`). */
  reference?: string;
  /** PagSeguro's numeric transaction status, verbatim (`<status>`). */
  statusCode: string;
  /** `<grossAmount>` in integer cents, when the response carries one. */
  grossAmountCents?: number;
  /** Payment method, normalized from `<paymentMethod><type>`. */
  method: PaymentMethodKind;
}

/** First `<tag>value</tag>` at any depth — the v3 response nests one level. */
function tagValue(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  const value = match?.[1]?.trim();
  return value ? value : undefined;
}

/**
 * A decimal-reais string ("459.50") in integer cents, without float math —
 * `Number("459.50") * 100` is 45949.99999999999 away from being money.
 */
function centsOf(decimal: string | undefined): number | undefined {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(decimal ?? '');
  if (!match) return undefined;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
}

/**
 * `<paymentMethod><type>` → our vocabulary. The legacy table: 1 is credit
 * card, 2 boleto; everything else (online debit, balance, deposit, PIX's
 * later addition) defaults to PIX — the same "PIX unless told otherwise"
 * default `orderSnapshot` uses, chosen because it is the one method a wrong
 * guess cannot re-charge.
 */
function methodOf(xml: string): PaymentMethodKind {
  const type = /<paymentMethod>[\s\S]*?<type>(\d+)<\/type>/.exec(xml)?.[1];
  if (type === '1') return 'CARD';
  if (type === '2') return 'BOLETO';
  return 'PIX';
}

/** The legacy credential pair, or a loud refusal naming what is missing. */
function legacyCredentials(credentials: ResolvedCredentials): { email: string; token: string } {
  const email = credentials.fields['legacyEmail'] ?? credentials.fields['email'];
  const token = credentials.fields['legacyToken'] ?? credentials.fields['token'];
  if (!email || !token) {
    throw new ProviderRequestError(
      NAME,
      'PagBank legacy notification lookup needs the account e-mail and API token ' +
        '(fields legacyEmail/email and legacyToken/token); a Connect access token cannot be used.',
      { retriable: false },
    );
  }
  return { email, token };
}

/** GET the notification's XML from the legacy host, error contract intact. */
async function fetchNotificationXml(
  notificationCode: string,
  credentials: ResolvedCredentials,
): Promise<string> {
  const { email, token } = legacyCredentials(credentials);
  const base = credentials.environment === 'PRODUCTION' ? LEGACY_HOSTS.PRODUCTION : LEGACY_HOSTS.SANDBOX;
  const query = new URLSearchParams({ email, token });
  const res = await fetch(
    `${base}/v3/transactions/notifications/${encodeURIComponent(notificationCode)}?${query.toString()}`,
    { method: 'GET', headers: { Accept: 'application/xml' } },
  );
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new ProviderRequestError(
      NAME,
      `PagBank legacy notification lookup ${res.status} ${res.statusText}: ${text.slice(0, 300)}`,
      { httpStatus: res.status, retriable: res.status >= 500 },
    );
  }
  return text;
}

/**
 * Parse the fields this module acts on out of the `<transaction>` document.
 *
 * The transaction-level `<code>` precedes the nested `<paymentMethod><code>`
 * in the documented response, which is what lets first-match win; a response
 * without a transaction code or status is refused rather than half-mapped —
 * the same rule as every other PagBank mapping.
 */
function parseTransaction(
  xml: string,
  notificationCode: string,
): PagbankLegacyNotificationDetail {
  const transactionCode = tagValue(xml, 'code');
  const statusCode = tagValue(xml, 'status');
  if (!transactionCode || !statusCode) {
    throw new ProviderRequestError(
      NAME,
      `PagBank legacy notification ${notificationCode} resolved to a transaction ` +
        'missing its code or status; refusing to half-map it.',
      { retriable: false },
    );
  }
  return {
    notificationCode,
    transactionCode,
    reference: tagValue(xml, 'reference'),
    statusCode,
    grossAmountCents: centsOf(tagValue(xml, 'grossAmount')),
    method: methodOf(xml),
  };
}

/** What each documented status means for the normalized event stream. */
type LegacyOutcome =
  | { kind: 'charge'; status: ChargeSnapshot['status'] }
  | { kind: 'refund' }
  | { kind: 'dispute' };

const OUTCOMES: Record<string, LegacyOutcome> = {
  '1': { kind: 'charge', status: 'PENDING' },
  '2': { kind: 'charge', status: 'PENDING' },
  '3': { kind: 'charge', status: 'PAID' },
  '4': { kind: 'charge', status: 'PAID' },
  '5': { kind: 'dispute' },
  '6': { kind: 'refund' },
  '7': { kind: 'charge', status: 'CANCELED' },
  '8': { kind: 'refund' },
  '9': { kind: 'dispute' },
};

/** The charge snapshot a resolved transaction supports. */
function legacyChargeSnapshot(
  detail: PagbankLegacyNotificationDetail,
  status: ChargeSnapshot['status'],
): ChargeSnapshot {
  if (status === 'PAID' && detail.grossAmountCents === undefined) {
    // Same refusal as `capturedAmountCents`: a settled charge with no amount
    // must fail loudly, not settle an order for a fabricated zero.
    throw new ProviderRequestError(
      NAME,
      `PagBank legacy transaction ${detail.transactionCode} is paid but carries no grossAmount; ` +
        'refusing to fabricate one.',
    );
  }
  return {
    provider: NAME,
    providerChargeId: detail.transactionCode,
    ...(detail.reference ? { reference: detail.reference } : {}),
    status,
    amount: { amountCents: detail.grossAmountCents ?? 0, currency: 'BRL' },
    method: detail.method,
    raw: detail,
  };
}

/**
 * The event stream for one resolved transaction. Event ids are STABLE per
 * (notification, status) — re-resolving the same notification dedups in the
 * inbox, while the same transaction's NEXT notification (a dispute that
 * becomes a chargeback) is a new event — and the refund ledger fact rides
 * under its own id because the inbox records one row per event.
 */
function eventsOf(detail: PagbankLegacyNotificationDetail): NormalizedWebhookEvent[] {
  const eventId = sha256Hex(`pagbank-legacy:${detail.notificationCode}:${detail.statusCode}`);
  const outcome = OUTCOMES[detail.statusCode];
  if (!outcome) {
    return [{ provider: NAME, eventId, type: 'UNKNOWN', raw: detail }];
  }
  if (outcome.kind === 'dispute') {
    // Money HELD, not moved: no snapshot may assert an outcome yet — see the
    // DISPUTE_UPDATED doc on `NormalizedWebhookEvent`.
    return [{ provider: NAME, eventId, type: 'DISPUTE_UPDATED', raw: detail }];
  }
  if (outcome.kind === 'charge') {
    return [
      {
        provider: NAME,
        eventId,
        type: 'CHARGE_UPDATED',
        charge: legacyChargeSnapshot(detail, outcome.status),
        raw: detail,
      },
    ];
  }
  // A refund/chargeback: the charge event is what takes the order out of
  // PAID (REFUNDED outranks PAID in the status ranks), the refund event is
  // the ledger fact — same pairing as the Orders-API webhook path.
  return [
    {
      provider: NAME,
      eventId,
      type: 'CHARGE_UPDATED',
      charge: legacyChargeSnapshot(detail, 'REFUNDED'),
      raw: detail,
    },
    {
      provider: NAME,
      eventId: `${eventId}:refund`,
      type: 'REFUND_UPDATED',
      refund: {
        provider: NAME,
        providerChargeId: detail.transactionCode,
        providerRefundId: detail.notificationCode,
        ...(detail.reference ? { reference: detail.reference } : {}),
        status: 'REFUNDED',
        amount: { amountCents: detail.grossAmountCents ?? 0, currency: 'BRL' },
        raw: detail,
      },
      raw: detail,
    },
  ];
}

/**
 * Resolve one legacy `notificationCode` into normalized webhook events — the
 * whole module's public face. See the header for the emitted contract.
 *
 * Stub mode resolves to NO events, deterministically: there is no legacy
 * system behind a stub deployment and an invented chargeback would be worse
 * than none.
 */
export async function resolvePagbankNotification(
  notificationCode: string,
  credentials: ResolvedCredentials,
): Promise<NormalizedWebhookEvent[]> {
  if (credentials.stub) return [];
  const xml = await fetchNotificationXml(notificationCode, credentials);
  return eventsOf(parseTransaction(xml, notificationCode));
}
