/**
 * Every word the PLATFORM's homologação screens render.
 *
 * The reader here is not a buyer and not a merchant: it is whoever operates
 * the platform, submitting a vendor homologação on behalf of every tenant on
 * it. That made this surface look internal enough to write literals into for a
 * long time, and it is not — a second platform adopting
 * `@12-apps/payments-frontend` mounts these same four cards, and its operator
 * reads whatever this package decided, in whatever language it decided.
 *
 * So the same rule as every other surface here: REQUIRED, no defaults. A pack
 * for one language ships as `PT_BR_PLATFORM_HOMOLOGACAO_COPY` and a host
 * passes it by hand.
 *
 * What is NOT here, deliberately: `HomologacaoGuide.fieldLabels` and the guide's
 * three URLs. Those are PagBank's own form field names and pages, answered by
 * the backend adapter, and a translation of them produces a submission their
 * form does not accept.
 */

/** The outcome card: what was submitted, and what came back. */
export interface HomologacaoOutcomeCopy {
  heading: string;
  /** The status a record carries — and what "no record at all" reads as. */
  statusLabel: string;
  notSubmitted: string;
  /** The two free-text fields, each with a visible-less input. */
  protocolLabel: string;
  protocolPlaceholder: string;
  notesLabel: string;
  notesPlaceholder: string;
  /** Save, and the confirmation after it. */
  save: string;
  saved: string;
  /** The three statuses a record can carry, keyed by the stored value. */
  statuses: Readonly<Record<string, string>>;
  /**
   * The trail under the heading, one clause per timestamp the record has. Each
   * takes its own value because the ORDER of word and date differs by language
   * and this line concatenates whichever clauses exist.
   */
  submittedAt(when: string): string;
  decidedAt(when: string): string;
  recordedBy(who: string): string;
}

/** The paste-ready answers card, and the three links woven through its lede. */
export interface HomologacaoGuideCopy {
  heading: string;
  /**
   * The instruction paragraph, in the runs it renders as: text, link, text,
   * link, text, link, text. Split because two of the links sit MID-SENTENCE,
   * so a single string with placeholders could not carry them.
   */
  ledeBeforeForm: string;
  formLink: string;
  ledeBeforeSupport: string;
  supportLink: string;
  ledeBeforeDocs: string;
  docsLink: string;
  ledeAfterDocs: string;
}

/** The evidence-file card. */
export interface HomologacaoAnexoCopy {
  heading: string;
  body: string;
  generate: string;
  /** A generate that threw something carrying no message of its own. */
  generateFailed: string;
}

/** The Connect application panel, and the environment card under it. */
export interface ConnectApplicationCopy {
  /** The callback the deployment uses — the value that must be registered. */
  expectedRedirectHeading: string;
  consultAgain: string;
  /** No application resolved for this environment at all. */
  noApplication: string;
  /**
   * The three verdicts on the registered `redirect_uri`: it matches, it does
   * not, or PagBank reported none to compare against. A mismatch is the whole
   * reason this card exists, so all three read as findings rather than states.
   */
  redirectMatches: string;
  redirectDiffers: string;
  redirectUnreported: string;
  /** The application's own fields, as PagBank reports them. */
  fields: {
    name: string;
    site: string;
    description: string;
    logo: string;
    redirectUri: string;
  };
  /** What a field with no value reads as, and an unreported redirect_uri. */
  fieldEmpty: string;
  redirectNotReported: string;
  /** Where the environment's application comes from, and its disclosure. */
  resolvedFrom: string;
  showConfig: string;
  hideConfig: string;
  /** The heading above whatever extra keys PagBank's response carried. */
  extraKeys: string;
  /** Each card's heading — the environment, in the operator's words. */
  environmentLabels: Readonly<Record<'SANDBOX' | 'PRODUCTION', string>>;
  /**
   * The preview of the values an application was consulted with: a heading,
   * what an unset value reads as, and each value's name when the host names no
   * configuration variables of its own (`configVarsFor`).
   */
  previewHeading: string;
  previewUnset: string;
  /** A value read from a fallback variable (production's token from the unsuffixed name). */
  previewInherited: string;
  credentialNames: { clientId: string; clientSecret: string; accountToken: string };
  /** The block that consults with PASTED credentials — rendered only when the host wires it. */
  pasted: {
    heading: string;
    /** Must say the values are not stored: the operator is pasting secrets. */
    lede: string;
    environment: string;
    submit: string;
    failed: string;
    /**
     * The consult authenticates with the account token and looks up the client
     * id; the secret is never sent. The answer must not read as "all three are good".
     */
    secretNotChecked: string;
  };
}

/** The homologação evidence card (FUT-3696) — the sandbox test seller and the TXT. */
export interface HomologacaoEvidenceCardCopy {
  heading: string;
  lede: string;
  sellerHeading: string;
  /** `connectedAt` is ISO-8601; the pack formats it in its own locale. */
  sellerConnected: (connectedAt: string | null, accountId: string | null) => string;
  sellerNotConnected: string;
  sellerReconnect: string;
  connectHint: string;
  connect: string;
  reconnect: string;
  connectFailed: string;
  returnedConnected: string;
  returnedFailed: string;
  generate: string;
  downloadLatest: string;
  phases: { preparing: string; encrypting: string; running: string; downloading: string };
  /** The run's step list (FUT-3755): which step is done, which one is going. */
  steps: {
    /** The bar's accessible name. */
    label: string;
    names: Record<'prepare' | 'encrypt' | 'PIX' | 'CARD' | 'DEBIT' | 'GOOGLE_PAY' | 'APPLE_PAY' | 'file', string>;
    /** Which wallets this generation carries a token for, and which stay pending. */
    walletsInRun: (included: string[], pending: string[]) => string;
  };
  summary: (counts: { executed: number; failed: number; pending: number }) => string;
  incomplete: string;
  /** Which phase failed — and that the latest recorded file can still be downloaded. */
  generateFailed: (phase: 'preparing' | 'encrypting' | 'running' | 'downloading') => string;
  /** The wallet step before generating (FUT-3755): each sheet opens on the operator's tap. */
  wallets: HomologacaoEvidenceWalletsCopy;
}

/** Why Apple Pay has no button on the evidence card (FUT-3755). */
export type AppleAbsence = 'NOT_CONFIGURED' | 'NOT_AVAILABLE' | 'MERCHANT_VALIDATION_FAILED';

/** The Google Pay / Apple Pay step of the evidence card (FUT-3755). */
export interface HomologacaoEvidenceWalletsCopy {
  heading: string;
  /** Each wallet's name, as the ready and failed lines say it. */
  names: { GOOGLE_PAY: string; APPLE_PAY: string };
  /** Why the buttons come before "generate", and that skipping them leaves the sections pending. */
  hint: string;
  /** The language Google draws its own button's label in. */
  googlePayButtonLocale: string;
  /** The Apple Pay button's accessible name. */
  applePayButton: string;
  /** The line Apple's sheet shows above the test amount. */
  applePaySheetTotal: string;
  /** Apple Pay could not start (no merchant validation). */
  applePayCannotStart: string;
  /** Apple Pay started and failed. */
  applePayCannotComplete: string;
  /** Why Apple Pay has no button here: the platform has no Apple Pay identity yet, or this browser has no sheet. */
  applePayAbsent: Record<AppleAbsence, string>;
  /** Why Google Pay has no button: the host carries no Google Pay configuration for this seller. */
  googlePayAbsent: string;
  /** A wallet holds its token: `card` is the network and last four the wallet showed — never the token. */
  ready: (wallet: string, card: string) => string;
  /** The sheet answered no token; pressing again retries. */
  failed: (wallet: string) => string;
}

/**
 * The PRODUCTION evidence card (FUT-4198): the sandbox card's sentences for the
 * parts it shares (the seller, the progress, the counts, the wallets), plus
 * the four steps, the cardholder, the real cards, the confirmation before real
 * money is charged and the Pix a person pays.
 */
export interface HomologacaoProductionEvidenceCopy extends HomologacaoEvidenceCardCopy {
  /** The four steps above the card, and the bar's accessible name. */
  stepper: {
    label: string;
    connect: string;
    data: string;
    charge: string;
    download: string;
    /** The phone's one line in place of four narrow labels: `Passo 2 de 4 · Titular e cartões`. */
    progress: (step: number, total: number, label: string) => string;
  };
  buyerHeading: string;
  buyerHint: string;
  fields: {
    name: string;
    taxId: string;
    email: string;
    phone: string;
    postalCode: string;
    street: string;
    number: string;
    complement: string;
    city: string;
    regionCode: string;
  };
  cardsHeading: string;
  credit: string;
  debit: string;
  cardFields: { number: string; expiry: string; securityCode: string };
  /** The debit card may be left blank: its section stays pending. */
  debitBlankHint: string;
  /** Why the charge button is not pressable yet. */
  incompleteData: string;
  /** Why it is not pressable while the run's Pix may still move money. */
  pixBlocksCharge: string;
  /**
   * Beside the form after a run: each scenario, recorded (its outcome is in
   * the file, never guessed here), pending, or where the Pix stands.
   */
  scenarios: {
    label: string;
    names: { credit: string; debit: string; pix: string; googlePay: string; applePay: string };
    recorded: string;
    pending: string;
    pix: Record<'AWAITING_PAYMENT' | 'REFUND_PENDING' | 'REFUNDED' | 'SKIPPED', string>;
  };
  /** The primary action: charge R$ 1,00 per scenario and refund it. */
  charge: string;
  confirm: {
    title: string;
    body: string;
    /** The label of the field where "confirmar" is typed. */
    typeLabel: string;
    /** The word to type. */
    word: string;
    submit: string;
    cancel: string;
  };
  pix: {
    title: string;
    hint: string;
    /** `minutesLeft` already formatted, e.g. `09:41`. */
    expires: (timeLeft: string) => string;
    copy: string;
    copied: string;
    skip: string;
    /** The QR's accessible name. */
    qrAlt: string;
    paid: string;
    skipped: string;
    /** Paid, the refund not done yet: the card keeps asking until it is. */
    refunding: string;
  };
  /** Step 4's button. */
  download: string;
}

/** The whole platform surface, in one object a host passes at the mount. */
export interface PlatformHomologacaoCopy {
  outcome: HomologacaoOutcomeCopy;
  guide: HomologacaoGuideCopy;
  anexo: HomologacaoAnexoCopy;
  connect: ConnectApplicationCopy;
  evidence: HomologacaoEvidenceCardCopy;
  /** The production evidence card (FUT-4198). */
  productionEvidence: HomologacaoProductionEvidenceCopy;
}
