import { AdapterContractError } from './errors';
import type { PaymentProviderAdapter } from './provider';
import type { MerchantRef, Money, ProviderName, ResolvedCredentials } from './types';

/**
 * INSTALMENTS with the buyer paying the acquirer's own interest (FUT-4382).
 *
 * A card charge split in N payments costs more than its principal, and who
 * pays that difference is the whole question. Here the BUYER does, at the rate
 * the provider itself quotes: the package sets no rate and keeps no table, so
 * the only number a charge is ever raised at is one the provider just named.
 *
 * Three rules follow from that:
 *
 *   - A provider QUOTES or it does not split. A provider with no
 *     {@link InstallmentCapability} is refused for any count above 1 — never
 *     charged once (the buyer asked for N), never charged the principal in N
 *     (the merchant would absorb interest nobody priced).
 *   - A quote is asked again at charge time. A total a buyer was shown an hour
 *     ago is a display, not a price; the charge takes the re-quote.
 *   - One payment is not a quote. A count of 1 is today's charge, at its
 *     principal, on any provider, with or without the capability.
 *
 * Kept out of `gateway.ts` and `provider.ts`, which sit at their size ceiling.
 */

/** The largest count a card charge carries (`CardDetails.installments`). */
export const MAX_INSTALLMENTS = 12;

/** What a provider is asked to price. */
export interface InstallmentQuoteInput {
  /** The PRINCIPAL — what the merchant is owed before any interest. */
  amount: Money;
  /** 2..12; a count of 1 never reaches a provider. */
  installments: number;
  /**
   * What the provider may price by: rates can differ per brand or issuer, so a
   * provider that needs to know the card reads one of these. All optional.
   */
  card: { savedCardToken?: string; bin?: string; brand?: string };
  /**
   * True for a charge raised with no cardholder present. Default false. Passed
   * to the provider too, which may price merchant- and customer-initiated
   * charges differently.
   */
  merchantInitiated?: boolean;
}

/** A provider's price for paying {@link InstallmentQuoteInput.amount} in N. */
export interface InstallmentQuote {
  installments: number;
  /** One payment, as the provider rounds it. */
  perInstallment: Money;
  /** Everything the buyer pays: the principal plus {@link interest}. */
  total: Money;
  /** `total - principal`; zero where the provider charges none at that count. */
  interest: Money;
}

/**
 * A provider's instalment pricing — optional on the adapter, and its absence
 * is the refusal (`installments-unsupported`).
 *
 * Declaring it is a claim about `createCharge` too: a card charge carrying
 * `card.installments > 1` is raised at the QUOTED total, so the adapter must
 * send that amount split in that count with the interest on the buyer, and
 * never subtract or re-add interest itself.
 */
export interface InstallmentCapability {
  /** The highest count this provider splits a charge into; at most 12. */
  readonly maxInstallments: number;
  /**
   * Whether a MERCHANT-INITIATED charge (no cardholder present, see
   * `CardDetails.merchantInitiated`) may be split. Separate because acquirers
   * that sell instalments at the counter do not all accept them on a stored
   * credential with nobody there to agree to the interest.
   */
  readonly merchantInitiated: boolean;
  quote(input: InstallmentQuoteInput, credentials: ResolvedCredentials): Promise<InstallmentQuote>;
}

/**
 * Why no quote — codes a host maps to its own copy, never sentences.
 *
 *   installments-unsupported         the provider prices no instalments
 *   installments-out-of-range        the count is not 1..12, or past the provider's maximum
 *   installments-merchant-initiated  the provider splits only with the cardholder present
 */
export type InstallmentRefusal =
  | 'installments-unsupported'
  | 'installments-out-of-range'
  | 'installments-merchant-initiated';

/** A host's request — the provider's own input, unchanged. */
export type InstallmentQuoteRequest = InstallmentQuoteInput;

export type InstallmentQuoteResult =
  | { ok: true; provider: ProviderName; quote: InstallmentQuote }
  | { ok: false; provider: ProviderName; refusal: InstallmentRefusal };

/** The gateway's quote call. */
export interface InstallmentQuoteMethods<P extends string = string> {
  /**
   * Optional on the interface so a host's own gateway fake keeps compiling;
   * `createPaymentsGateway` always provides it.
   *
   * Price `request.amount` in `request.installments` at the merchant's head
   * provider, or the `provider` named — what a host shows the buyer BEFORE
   * paying. A count of 1 answers the principal, interest-free, without asking
   * the provider. A provider that cannot price the count is a typed refusal,
   * not a throw; a provider failing to answer still throws.
   */
  quoteInstallments?(
    merchant: MerchantRef,
    request: InstallmentQuoteRequest,
    provider?: P,
  ): Promise<InstallmentQuoteResult>;
}

/** The gateway's `(merchant, provider) -> adapter + credentials` resolution. */
type ResolveFor = (
  merchant: MerchantRef,
  provider?: string,
) => Promise<{ adapter: PaymentProviderAdapter; creds: ResolvedCredentials }>;

/** Whether `count` is a count a card charge can carry at all. */
export function isInstallmentCount(count: number): boolean {
  return Number.isInteger(count) && count >= 1 && count <= MAX_INSTALLMENTS;
}

const money = (amountCents: number, currency: string): Money => ({ amountCents, currency });

/** One payment: the principal, nothing added. */
function singlePayment(amount: Money): InstallmentQuote {
  return { installments: 1, perInstallment: amount, total: amount, interest: money(0, amount.currency) };
}

function refusalFor(
  capability: InstallmentCapability | undefined,
  request: InstallmentQuoteRequest,
): InstallmentRefusal | null {
  if (!isInstallmentCount(request.installments)) return 'installments-out-of-range';
  if (request.installments === 1) return null;
  if (!capability) return 'installments-unsupported';
  if (request.installments > capability.maxInstallments) return 'installments-out-of-range';
  if (request.merchantInitiated && !capability.merchantInitiated) return 'installments-merchant-initiated';
  return null;
}

/**
 * A quote the charge may be raised at — refused loudly otherwise, because a
 * total below the principal or in another currency would charge the buyer a
 * number nobody asked for.
 *
 * `perInstallment × installments` may differ from `total` by LESS than
 * `installments` cents: a provider rounds each payment to the cent and settles
 * the remainder on one of them, so N payments can be off by at most N-1 cents.
 */
function checkedQuote(provider: ProviderName, input: InstallmentQuoteInput, quote: InstallmentQuote) {
  const { amount, installments } = input;
  const sameCurrency = [quote.total, quote.perInstallment, quote.interest].every((m) => m.currency === amount.currency);
  const consistent = quote.total.amountCents - quote.interest.amountCents === amount.amountCents;
  const rounded = Math.abs(quote.perInstallment.amountCents * installments - quote.total.amountCents) < installments;
  if (quote.installments !== installments || !sameCurrency || !consistent || !rounded || quote.interest.amountCents < 0) {
    throw new AdapterContractError(provider, `installment quote does not price ${input.installments}x of the principal`);
  }
  return quote;
}

/** Build the gateway's `quoteInstallments`. */
export function quoteInstallmentsAt(resolve: ResolveFor) {
  return async function quoteInstallments(
    merchant: MerchantRef,
    request: InstallmentQuoteRequest,
    provider?: string,
  ): Promise<InstallmentQuoteResult> {
    const { adapter, creds } = await resolve(merchant, provider);
    const refusal = refusalFor(adapter.installments, request);
    if (refusal) return { ok: false, provider: adapter.name, refusal };
    if (request.installments === 1 || !adapter.installments) {
      return { ok: true, provider: adapter.name, quote: singlePayment(request.amount) };
    }
    const input = {
      amount: request.amount,
      installments: request.installments,
      card: request.card,
      merchantInitiated: request.merchantInitiated ?? false,
    };
    const quote = await adapter.installments.quote(input, creds);
    return { ok: true, provider: adapter.name, quote: checkedQuote(adapter.name, input, quote) };
  };
}

/** The simulated pricing's knobs. */
export interface SimulatedInstallmentOptions {
  /** Monthly interest in basis points. Default 299 (2.99% a month). */
  monthlyRateBps?: number;
  /** Default 12. */
  maxInstallments?: number;
  /** Default true. */
  merchantInitiated?: boolean;
}

/**
 * The price-table payment for `principal` over `count` at `rate` a month. No
 * rate, no interest: each payment rounds UP and the total stays the principal,
 * which keeps `per × count - total` under `count` cents, as `checkedQuote` asks.
 */
function amortised(principal: number, rate: number, count: number): { per: number; total: number } {
  if (rate === 0) return { per: Math.ceil(principal / count), total: principal };
  const per = Math.round((principal * rate) / (1 - (1 + rate) ** -count));
  return { per, total: per * count };
}

/**
 * A deterministic {@link InstallmentCapability} for tests and stub mode: 1x is
 * interest-free, 2..N are priced on a fixed monthly rate with the standard
 * amortised (price-table) payment, rounded to the cent. Attach it to any
 * adapter — `{ ...adapter, installments: simulatedInstallments() }` — to drive
 * the whole path with no provider behind it. Never a real acquirer's rate.
 */
export function simulatedInstallments(options: SimulatedInstallmentOptions = {}): InstallmentCapability {
  const rate = (options.monthlyRateBps ?? 299) / 10_000;
  return {
    maxInstallments: options.maxInstallments ?? MAX_INSTALLMENTS,
    merchantInitiated: options.merchantInitiated ?? true,
    async quote({ amount, installments }) {
      const { per, total } = amortised(amount.amountCents, installments <= 1 ? 0 : rate, Math.max(installments, 1));
      return {
        installments,
        perInstallment: money(per, amount.currency),
        total: money(total, amount.currency),
        interest: money(total - amount.amountCents, amount.currency),
      };
    },
  };
}
