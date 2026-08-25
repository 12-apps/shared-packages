import { resolvePaymentsCopy, type PaymentsCopySource } from '../copy-source';

/**
 * The receipt mailer — the wiring contract's `email` capability, restated
 * structurally (the port twin below IS `EmailPort`, field for field).
 *
 * The gap it closes: a paid charge is the one moment every shop wants to put
 * in the buyer's inbox, and this package had no way to say so — hosts either
 * wired a bespoke mailer beside the payment path or sent nothing. What is
 * genuinely this package's is the SEAM: the normalized receipt shape (what a
 * charge looks like once provider vocabulary is gone), the semantic send,
 * and the rule that delivery goes through the host's ONE driver — retries,
 * logging and PII rules included. Every sentence stays the host's: `copy`
 * renders the three parts of the mail from the receipt, is REQUIRED, and has
 * no default in any language — a default here would be the exact silent
 * vocabulary leak the portability gates exist to refuse.
 *
 * ## Which language a receipt is written in
 *
 * The BUYER's, off {@link PaymentsReceipt.locale} — never the deployment's and
 * never the request's. A receipt is read by whoever paid, in their own inbox,
 * at a moment that has nothing to do with the call that settled the charge:
 * the send is frequently a webhook or a reconciliation sweep, where there is
 * no caller with an `Accept-Language` at all.
 *
 * So `copy` is a {@link PaymentsCopySource} and {@link createReceiptMailer}
 * resolves it inside `sendReceipt`, per message. Not at the mount: a mailer
 * built once per process and closed over one pack would write every receipt
 * that deployment ever sends in the same language, and a single-locale host
 * cannot tell the difference.
 */

/** Twin of the wiring contract's `WireEmailMessage`: one formatted mail. */
export interface PaymentsEmailMessage {
  subject: string;
  text: string;
  html: string;
}

/** Twin of the wiring contract's `EmailPort` — the host's one driver. */
export interface PaymentsEmailPort {
  send(to: string, message: PaymentsEmailMessage): Promise<void>;
}

/**
 * One settled charge, as a receipt reads it — provider vocabulary already
 * normalized away. `providerName` is the host-facing display name a config
 * chose, never a hardwired vendor string.
 */
export interface PaymentsReceipt {
  /** The host's own order/charge reference — whatever the buyer can quote. */
  reference: string;
  amountCents: number;
  currency: string;
  /** The normalized method (`card`, `pix`, `boleto`, …). */
  method: string;
  paidAt: Date;
  /** Display name of the provider that settled it, when the host shows one. */
  providerName?: string;
  /**
   * The language to write this receipt in — the BUYER's, off their own row.
   *
   * Absent means "nobody said", which is different from asserting a language:
   * the host's resolver applies its default in one place rather than each send
   * inventing one. A host with one audience never sets it and passes a plain
   * pack, and nothing about its wiring changes.
   */
  locale?: string | null;
}

/** The host's words: the three parts of the mail, rendered from the receipt. */
export interface ReceiptMailCopy {
  subject(receipt: PaymentsReceipt): string;
  text(receipt: PaymentsReceipt): string;
  html(receipt: PaymentsReceipt): string;
}

export interface ReceiptMailerOptions {
  /** The host's one delivery driver. Throws on failure; the caller owns retry. */
  deliver: PaymentsEmailPort;
  /**
   * REQUIRED, no default in any language — the host's sentences.
   *
   * A pack, or a RESOLVER for a host whose buyers do not share a language. The
   * resolver is stored, never called, until `sendReceipt` has a receipt to ask
   * about.
   */
  copy: PaymentsCopySource<ReceiptMailCopy>;
}

export interface PaymentsReceiptMailer {
  /** Render the receipt through the host's copy and deliver it. */
  sendReceipt(to: string, receipt: PaymentsReceipt): Promise<void>;
}

/** The three renderers are all there — the check a missing seam fails on. */
function assertRenderers(copy: ReceiptMailCopy | undefined): ReceiptMailCopy {
  if (
    typeof copy?.subject !== 'function' ||
    typeof copy.text !== 'function' ||
    typeof copy.html !== 'function'
  ) {
    throw new Error('createReceiptMailer needs copy.{subject,text,html} — the words are the host\'s.');
  }
  return copy;
}

export function createReceiptMailer(options: ReceiptMailerOptions): PaymentsReceiptMailer {
  const { deliver, copy } = options;
  /**
   * Checked at the MOUNT, against the resolver's DEFAULT rendering.
   *
   * Deliberately with no locale: a host that wired a half-built copy object
   * must fail where it wires it, not on the first charge that settles — a
   * receipt that throws mid-webhook is a mail the buyer never gets and a
   * retry loop nobody asked for.
   */
  assertRenderers(resolvePaymentsCopy(copy, undefined));

  return {
    async sendReceipt(to, receipt) {
      // Resolved per message: this is the moment the buyer is known.
      const words = assertRenderers(resolvePaymentsCopy(copy, receipt.locale ?? undefined));
      await deliver.send(to, {
        subject: words.subject(receipt),
        text: words.text(receipt),
        html: words.html(receipt),
      });
    },
  };
}
