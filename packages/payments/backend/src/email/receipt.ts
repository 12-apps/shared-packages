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
  /** REQUIRED, no default in any language — the host's sentences. */
  copy: ReceiptMailCopy;
}

export interface PaymentsReceiptMailer {
  /** Render the receipt through the host's copy and deliver it. */
  sendReceipt(to: string, receipt: PaymentsReceipt): Promise<void>;
}

export function createReceiptMailer(options: ReceiptMailerOptions): PaymentsReceiptMailer {
  const { deliver, copy } = options;
  if (typeof copy?.subject !== 'function' || typeof copy.text !== 'function' || typeof copy.html !== 'function') {
    throw new Error('createReceiptMailer needs copy.{subject,text,html} — the words are the host\'s.');
  }
  return {
    async sendReceipt(to, receipt) {
      await deliver.send(to, {
        subject: copy.subject(receipt),
        text: copy.text(receipt),
        html: copy.html(receipt),
      });
    },
  };
}
