import type { DeclineReason } from '../core/types';

/**
 * PagBank's decline vocabulary, normalized (FUT-340).
 *
 * Until this existed `cardOutcome()` collapsed EVERY refusal to
 * `CARD_DECLINED`, which is survivable for a storefront (the buyer is standing
 * there and simply tries another card) and not survivable for a subscription
 * charged on a timer: "do not retry when the money is not there" is
 * undecidable if no-funds and issuer-offline arrive as the same value.
 *
 * The table is PagBank's own — "Motivos de compra negada", the ABECS
 * normative-21 list carried on `payment_response.code`. Two columns of it
 * matter, and they answer different questions:
 *
 *   `reason`     WHAT happened, in the cross-provider vocabulary the host
 *                shows a human and branches its dunning on.
 *   `retriable`  PagBank's OWN verdict on whether another attempt with the
 *                same card could ever succeed — the "Retentável" column,
 *                echoed in the message text as "NAO TENTE NOVAMENTE".
 *
 * Keeping both is the point. `DeclineReason` has seven values and this table
 * has thirty-three rows, so the projection is lossy in exactly the direction
 * that matters: a malformed request (10003), an invalid merchant (20017) and a
 * cancelled recurring mandate (20118) are all terminal, and all of them would
 * have to be flattened into a reason whose honest meaning is "the card was
 * declined" — telling a tenant to replace a perfectly good card. Carrying
 * `retriable` separately lets the reason stay truthful while the retry
 * decision stays correct.
 *
 * ## The table has a SECOND dimension (FUT-475)
 *
 * `payment_response.code` is only the first column. Each code fans out to
 * several issuer reasons, told apart by the network's own code in
 * `payment_response.raw_data.reason_code` — 33 codes over 72 published rows.
 * Reading the code alone throws that away, and in three places the discarded
 * half is the part that mattered:
 *
 *   20007 covers a wrong number, a bad CVV AND **CARTÃO VENCIDO** (54 / Amex
 *         101). An earlier version of this comment concluded from the folded
 *         code that `EXPIRED_CARD` was unreachable on PagBank. It is not: the
 *         distinction is published, it just is not in the column we read.
 *   20017 is mapped to `PROVIDER_ERROR` for COMERCIANTE INVÁLIDO (3), but the
 *         same code carries CARTÃO PERDIDO (41) and CARTÃO ROUBADO (43) — a
 *         stolen card reported to the tenant as a fault in our own system.
 *   20039 is mapped to `FRAUD_SUSPECTED`, and carries CONTA ENCERRADA (46) —
 *         "we suspect fraud" for an account that simply no longer exists.
 *
 * {@link ISSUER_REASONS} refines those, and only those. It never touches
 * `retriable`: PagBank's "Retentável" column spans all of a code's sub-rows,
 * so the sub-reason cannot disagree with it.
 */

/** One row of PagBank's denied-purchase table. */
interface PagBankDecline {
  reason: DeclineReason;
  /** PagBank's "Retentável" column: may the SAME card be tried again? */
  retriable: boolean;
}

/**
 * `payment_response.code` → normalized outcome.
 *
 * Exactly the 33 codes PagBank documents, no more: an unknown code falls
 * through to {@link UNRECOGNIZED_DECLINE} rather than being guessed at, and
 * `pagbank-declines.test.ts` pins the set against the published one so a
 * divergence fails CI instead of surfacing as a mis-handled decline.
 */
export const PAGBANK_DECLINE_CODES: Readonly<Record<string, PagBankDecline>> = {
  // ── PagBank's own refusals (10xxx) — the acquirer, not the issuer ────────
  /** Blocked by PagBank's antifraud, which re-scores a later attempt. */
  '10000': { reason: 'FRAUD_SUSPECTED', retriable: true },
  /** Authorization attempts exhausted — hammering it is what caused this. */
  '10001': { reason: 'CARD_DECLINED', retriable: false },
  /** Generic issuer refusal with no stated cause. */
  '10002': { reason: 'CARD_DECLINED', retriable: true },
  /** Malformed transaction: OUR request is wrong, so a repeat is too. */
  '10003': { reason: 'PROVIDER_ERROR', retriable: false },
  '10004': { reason: 'CARD_DECLINED', retriable: false },

  // ── Issuer refusals (2xxxx) ──────────────────────────────────────────────
  '20001': { reason: 'CARD_DECLINED', retriable: true },
  /**
   * SALDO/LIMITE INSUFICIENTE. PagBank marks it retriable and is right at its
   * own grain — the cardholder may top up. It is still the one reason the
   * billing job must not retry on a TIMER; that policy lives with the job,
   * which is why this row reports what PagBank said rather than pre-empting it.
   */
  '20003': { reason: 'INSUFFICIENT_FUNDS', retriable: true },
  /** Card data rejected: wrong number, bad CVV, or an expired card — which
   *  {@link ISSUER_REASONS} tells apart when the reason code is present. */
  '20007': { reason: 'INVALID_CARD', retriable: false },
  /** Installment amount invalid — a request problem, not a card problem. */
  '20008': { reason: 'PROVIDER_ERROR', retriable: false },
  '20012': { reason: 'PROVIDER_ERROR', retriable: false },
  /** COMERCIANTE INVALIDO — the merchant account, not the buyer's card. */
  '20017': { reason: 'PROVIDER_ERROR', retriable: false },
  /** Retain card (no fraud) — the issuer has withdrawn it. */
  '20018': { reason: 'INVALID_CARD', retriable: false },
  /** EMISSOR FORA DO AR — pure availability, the textbook backoff case. */
  '20019': { reason: 'PROVIDER_ERROR', retriable: true },
  '20039': { reason: 'FRAUD_SUSPECTED', retriable: false },

  // ── PIN / withdrawal codes (201xx). Unreachable on an e-commerce card
  //    charge, listed so an unexpected one is normalized rather than guessed.
  '20101': { reason: 'CARD_DECLINED', retriable: false },
  '20102': { reason: 'CARD_DECLINED', retriable: true },
  '20103': { reason: 'CARD_DECLINED', retriable: true },
  /** VALOR EXCEDIDO — the limit, reached from the other side. */
  '20104': { reason: 'INSUFFICIENT_FUNDS', retriable: true },
  '20105': { reason: 'CARD_DECLINED', retriable: true },
  '20110': { reason: 'INVALID_CARD', retriable: false },
  '20111': { reason: 'INVALID_CARD', retriable: false },
  '20112': { reason: 'PROVIDER_ERROR', retriable: false },
  '20113': { reason: 'INVALID_CARD', retriable: false },
  '20114': { reason: 'INVALID_CARD', retriable: false },
  '20115': { reason: 'CARD_DECLINED', retriable: false },
  /** BIN not recognized — the number does not belong to any issuer. */
  '20116': { reason: 'INVALID_CARD', retriable: false },
  /** A fault inside the acquirer itself, which PagBank says not to repeat. */
  '20117': { reason: 'PROVIDER_ERROR', retriable: false },
  /**
   * SUSPENSAO DE PAGAMENTO RECORRENTE — the cardholder cancelled the standing
   * authorization at their bank. The single most subscription-relevant row in
   * the table, and the one where retrying is not merely futile: continuing to
   * present a revoked recurring debit is what earns chargebacks.
   */
  '20118': { reason: 'CARD_DECLINED', retriable: false },
  /** The issuer explicitly asks for the transaction to be redone. */
  '20119': { reason: 'CARD_DECLINED', retriable: true },
  '20158': { reason: 'CARD_DECLINED', retriable: true },
  /** FRAUDE/SEGURANCA — retriable only WITH authentication, which an
   *  off-session subscription charge by definition cannot do. */
  '20159': { reason: 'FRAUD_SUSPECTED', retriable: false },
  /** A new card the holder never unblocked; they can, then it works. */
  '20301': { reason: 'CARD_DECLINED', retriable: true },
  '20999': { reason: 'PROVIDER_ERROR', retriable: true },
};

/**
 * Note there is no row for `20000` (SUCESSO). Approval is decided by the
 * charge's STATUS, which the adapter checks first; a code only ever reaches
 * this table once we already know the charge was refused.
 */

/**
 * (code, `reason_code`) → the reason the code alone could not express.
 *
 * Deliberately PARTIAL, on two rules.
 *
 * **Only where it changes the answer.** A sub-row that normalizes to what the
 * code already says is not listed; the base table answers it. So the absence
 * of a pair here means "no refinement", never "not documented".
 *
 * **Only where the pair is unambiguous.** The published columns are per
 * network (Mastercard/Hipercard, Visa, Elo, Amex) and the response does not
 * say which network answered, so a reason code that means different things to
 * two networks under the SAME code cannot be resolved from what we receive.
 * Elo's `57` under 20039 is three different things; `58` under 20017 is two.
 * Those are left to the base mapping rather than guessed — the same stance the
 * Connect error table takes, for the same reason: a confident wrong
 * explanation is worse than none.
 */
const ISSUER_REASONS: Readonly<Record<string, Readonly<Record<string, DeclineReason>>>> = {
  '20001': {
    /** SUSPEITA DE FRAUDE — the code's generic "call your bank" hides it. */
    '59': 'FRAUD_SUSPECTED',
    '63': 'FRAUD_SUSPECTED',
  },
  '20007': {
    /** CARTÃO VENCIDO / DT EXPIRAÇÃO INVÁLIDA — ABECS 54, Amex 101. */
    '54': 'EXPIRED_CARD',
    '101': 'EXPIRED_CARD',
    /**
     * CICLO DE VIDA: the issuer reissued the card, so the number on file is
     * dead and a new one exists. `EXPIRED_CARD` is the taxonomy's closest
     * truth — what the tenant must do is exactly what an expiry demands.
     */
    '79': 'EXPIRED_CARD',
  },
  '20017': {
    /** CARTÃO PERDIDO — the card, not the merchant account. */
    '41': 'INVALID_CARD',
    /** CARTÃO ROUBADO. */
    '43': 'FRAUD_SUSPECTED',
    /** CICLO DE VIDA — reissued, as under 20007. */
    '79': 'EXPIRED_CARD',
    /** FRAUDE/SEGURANÇA. */
    '83': 'FRAUD_SUSPECTED',
  },
  '20018': {
    /** REVERSÃO INVÁLIDA — a messaging fault, not a card the tenant can fix. */
    '76': 'PROVIDER_ERROR',
    /** NÃO LOCALIZADO PELO ROTEADOR. */
    '92': 'PROVIDER_ERROR',
    /** VALOR DO TRACING DATA DUPLICADO. */
    '94': 'PROVIDER_ERROR',
  },
  '20039': {
    /** CONTA ENCERRADA — the account is gone; nobody defrauded anybody. */
    '46': 'INVALID_CARD',
    /** TRANSAÇÃO NEGADA POR INFRAÇÃO DE LEI — a refusal, not a fraud score. */
    '93': 'CARD_DECLINED',
    /** TRANSAÇÃO NÃO QUALIFICADA PARA VISA PIN — our request's shape. */
    R2: 'PROVIDER_ERROR',
  },
};

/**
 * What PagBank returns alongside the code, verbatim from its own example:
 *
 * ```json
 * "payment_response": {
 *   "code": "20017", "message": "TRANSACAO NAO PERMITIDA - NAO TENTE NOVAMENTE",
 *   "reference": "021646094820",
 *   "raw_data": { "authorization_code": "022188", "nsu": "021646094820",
 *                 "reason_code": "83", "merchant_advice_code": "03" }
 * }
 * ```
 *
 * (The table's column headers spell the path `payment_response.message.raw_data`,
 * which cannot be right — `message` is a string in that same example. The
 * payload wins.)
 */
export interface PagBankPaymentRawData {
  reason_code?: string;
  merchant_advice_code?: string;
}

/**
 * The published table prints reason codes unpadded (`3`, `54`) while the
 * payload pads them (`03`) — the same example shows `merchant_advice_code`
 * as `"03"` for the row printed as `3`. Compare on the unpadded form so the
 * two agree, and uppercase for the alphanumeric ones (`R2`, `N0`, `6P`).
 */
function normalizeReasonCode(code: string): string {
  const trimmed = code.trim().toUpperCase();
  return trimmed.replace(/^0+(?=.)/, '');
}

/**
 * What an unlisted code means. `CARD_DECLINED` because that is the honest
 * summary of "the issuer said no and we do not know why", and retriable
 * because withholding a retry on an unknown code would silently stop
 * collecting from a tenant whose card is fine. The failure direction is a
 * wasted attempt, bounded by the job's own attempt cap — never a silent
 * cancellation.
 */
const UNRECOGNIZED_DECLINE: PagBankDecline = { reason: 'CARD_DECLINED', retriable: true };

/**
 * Normalize a `payment_response.code`, refined by `raw_data` when PagBank sent
 * one.
 *
 * A charge with no `payment_response` at all is treated as unrecognized: the
 * status already told us it was not paid, and inventing a specific reason from
 * a missing field would be a guess dressed as a fact. `raw_data` is optional
 * for the same reason it is optional in the payload — every code still answers
 * without it, exactly as before.
 */
export function pagbankDecline(
  code: string | undefined,
  raw?: PagBankPaymentRawData | undefined,
): PagBankDecline {
  const base = PAGBANK_DECLINE_CODES[code ?? ''] ?? UNRECOGNIZED_DECLINE;
  const reasonCode = raw?.reason_code;
  if (!code || !reasonCode) return base;
  const refined = ISSUER_REASONS[code]?.[normalizeReasonCode(reasonCode)];
  // `retriable` is never refined: the "Retentável" column spans a code's whole
  // block, so the sub-row has nothing to add and everything to contradict.
  return refined ? { reason: refined, retriable: base.retriable } : base;
}
