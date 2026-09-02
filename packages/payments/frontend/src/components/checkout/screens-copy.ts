/**
 * Every sentence the buyer's checkout SCREENS render (FUT-760).
 *
 * The step wrappers already took theirs through `CheckoutViewCopy`; this is
 * what sits inside them — the method tiles, the PIX and card panes, the wallet
 * buttons, the hosted handover, and the refusals any of them can produce.
 *
 * Required, with no defaults. The split is the one the whole port draws: WHICH
 * situation the buyer is in — a charge still settling, one taking longer than
 * it should, a wallet this store cannot start, a provider page they are about
 * to be sent to — is knowledge of the payment lifecycle, and it stays in the
 * package. The words are the host's.
 *
 * Two members are LOCALES rather than sentences (`pix.expiryLocale`,
 * `wallet.googlePay.buttonLocale`). They are here for the same reason: both
 * were hard-coded to Brazilian Portuguese, and both decide what a buyer reads
 * — one formats the PIX expiry clock, the other is the language Google draws
 * its own button in. A host that translates every string below and still ships
 * `"pt"` to Google has a checkout in two languages.
 */

/** The method tiles, and what each one promises. */
export interface MethodPickerCopy {
  /** The group's heading, and its `aria-label` — one string, said once. */
  groupLabel: string;
  /**
   * What each method is CALLED. "PIX" is a Brazilian instrument and keeps its
   * name everywhere, the way "Visa" does; "Cartão" is just the word for card,
   * and was the tile's label — so both are stated rather than one assumed.
   */
  pixLabel: string;
  cardLabel: string;
  /** What each method is like to use — shown under its name. */
  pixDescription: string;
  cardDescription: string;
  /** This store's providers cannot take that method. */
  unavailableHere: string;
}

/**
 * What a charge in flight says, shared by the PIX, card and wallet panes.
 *
 * One slice rather than three, because these ARE the same four states — and
 * three copies of them is how a product ends up telling a buyer two different
 * things about one situation depending on which button they pressed.
 */
export interface SettlingCopy {
  /** The provider answered, and the answer was not a payment. */
  cannotConfirm: string;
  /** Still open past the point where a buyer starts to worry. */
  takingLonger: string;
  /**
   * The one sentence in here that prevents money moving twice: a buyer who
   * pays again because the screen went quiet has been charged twice, and only
   * this line stands between them and that.
   */
  takingLongerHelp: string;
  /** The charge is on its way to the provider. */
  processing: string;
  /** It arrived, and settlement is being confirmed. */
  confirming: string;
  /** It came back refused. */
  cannotPay: string;
  /**
   * We cannot reach the payment right now — a dropped connection, a handset
   * moving between Wi-Fi and 4G, a browser that aborted our requests while the
   * shopper was in their bank app (FUT-1144).
   *
   * TRANSIENT, and the sentence must say so: the screen is still asking, on a
   * backoff, and it re-asks the moment the tab comes back or the signal
   * returns. This was `cannotConfirm` — "não foi possível confirmar o
   * pagamento" — under which the wait had actually STOPPED, so a shopper who
   * had paid read a final-sounding refusal and was never told otherwise.
   */
  connectionLost: string;
  /**
   * Ask again, now. Offered beside {@link connectionLost} and beside the
   * elapsed wait, because a shopper watching a screen that cannot reach us
   * needs something to press — and because pressing it is what restarts a wait
   * that has run out.
   */
  checkAgainAction: string;
}

/** The PIX pane: the QR, the copyable code, and the wait. */
export interface PixPaneCopy {
  heading: string;
  /** What to do with the QR, carrying the order total the buyer is paying. */
  instructions(totalLabel: string): string;
  /** The QR image's alternative text — the only thing a screen reader gets. */
  qrAlt: string;
  copyAction: string;
  /** The same button for the two seconds after a successful copy. */
  copiedAction: string;
  /**
   * How long the code lasts. Takes the already-formatted clock time, and
   * {@link expiryLocale} is what formatted it.
   */
  validUntil(time: string): string;
  /**
   * The BCP-47 tag the expiry clock is formatted in — `'pt-BR'` here, and a
   * hard-coded one before this port. Beside the sentence it feeds rather than
   * in a config elsewhere, because they are one decision.
   */
  expiryLocale: string;
  /** The live footer while nothing has been paid yet. */
  awaiting: string;
  /** The order came back with no PIX charge on it — nothing to show. */
  chargeMissing: string;
}

/** The card pane's own heading. Everything else in it is {@link SettlingCopy}. */
export interface CardPaneCopy {
  heading: string;
}

/** Who is paying, as the checkout has understood it. */
export interface PayerSummaryCopy {
  taxId(formatted: string): string;
  /** The store already holds this CPF — nothing to re-enter. */
  taxIdAlreadyKnown: string;
  payingAs(name: string): string;
  payingWithSavedDetails: string;
  /** Reopen the buyer-details step to pay as somebody else. */
  changeAction: string;
}

/** The refusal panel, and what a buyer can do about it. */
export interface PaymentErrorCopy {
  confirming: string;
  cannotContinue: string;
  /** Only offered for a refusal that is SAFE to retry — never an unresolved one. */
  retryAction: string;
  emailLabel: string;
  /** Why the store's own address will not do. */
  emailMustDifferHint: string;
  useEmailAction: string;
}

/** The two wallet buttons — what they say when they cannot run. */
export interface WalletCopy {
  applePay: {
    /** The line item Apple's own sheet shows above the amount. */
    orderTotal: string;
    /** This store cannot offer Apple Pay at all. */
    cannotStart: string;
    /** It started and failed. */
    cannotComplete: string;
    payAction: string;
  };
  googlePay: {
    cannotComplete: string;
    /**
     * The language Google draws its button's own label in. Google owns those
     * pixels, so this is the only say a host has over them.
     */
    buttonLocale: string;
  };
  /** The divider under the wallet buttons, pointing at the form below. */
  orPayWithCard: string;
}

/** The interstitial before a buyer leaves for a provider's own page. */
export interface HostedHandoverCopy {
  /**
   * Where they are going. Named when the adapter says who it is, generic
   * otherwise — "a página de pagamento do provedor" is the same sentence with
   * the one useful word removed.
   */
  destinationNamed(displayName: string): string;
  destinationGeneric: string;
  /** The methods the hosted page will offer, when we know them. */
  methodsChoice(methods: string): string;
  /** Which methods those are — read from what the provider actually declared. */
  pixAndCard: string;
  pixOnly: string;
  cardOnly: string;
  /** The whole sentence, composed from the two above. */
  handoff(destination: string, choice: string): string;
  /** What happens after they pay over there. */
  afterwards: string;
  startAction: string;
  preparing: string;
}

/** What the browser says when the wire itself failed. */
export interface CheckoutTransportCopy {
  /** A refusal whose envelope carried no sentence of its own. */
  failed: string;
  /** A 2xx that was not the shape the route promises. */
  invalidResponse: string;
  /** The request never got out — the one of the three a buyer really meets. */
  offline: string;
}

/** The buyer-details validators, field by field. */
export interface CheckoutValidationCopy {
  taxIdInvalid: string;
  nameRequired: string;
  emailInvalid: string;
  phoneInvalid: string;
  /** Any other declared field the store demands and the buyer left empty. */
  required: string;
}

/** Everything above, in the shape the checkout context carries. */
export interface CheckoutScreensCopy {
  method: MethodPickerCopy;
  settling: SettlingCopy;
  pix: PixPaneCopy;
  card: CardPaneCopy;
  payer: PayerSummaryCopy;
  error: PaymentErrorCopy;
  wallet: WalletCopy;
  hosted: HostedHandoverCopy;
  transport: CheckoutTransportCopy;
  validation: CheckoutValidationCopy;
  /** The step wrapper's own wait, while the charge is being raised. */
  generatingPayment: string;
}
